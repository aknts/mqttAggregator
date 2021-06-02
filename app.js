process.title = 'aggregator';
// Initialization 
// Config
const config = JSON.parse(Buffer.from(require('./config.js'), 'base64').toString());

// Settings
var broker = config.globalsettings.broker;
var mynodeid = config.mynodeid;
var logtopic = mynodeid+'/log';
var controltopic = mynodeid+'/control';
var previousnode = config.previousnode;
var previousnodebroadcasttopic = previousnode+'/broadcast';
var appname = config.appname;
var kubectlproxy = config.kubeproxy.split(":");
var namespace = config.namespace;
var pipelinetopic = config.nameid+'/broadcast'
var rate_reconnect = config.appsettings.rate_reconnect;
var logmode = config.appsettings.logmode;
var mariadb = config.appsettings.mariadb;

// Modules
const mqttmod = require('mqttmod');
const staticServer = require('./staticserver');
const l = require('mqttlogger')(broker, logtopic, mqttmod, logmode);
var mysql = require('mysql');
var pool  = mysql.createPool({
  connectionLimit : 10,
  host            : mariadb.host,
  port			  : mariadb.port,
  user            : mariadb.user,
  password        : mariadb.password
});

// Variables
var readyresponse = '{"node":"'+mynodeid+'","name":"aggregator","request":"ready"}';
var execresponse = '{"node":"'+mynodeid+'","name":"aggregator","request":"execute"}';
var terminatingresponse = '{"node":"'+mynodeid+'","name":"aggregator","request":"terminating"}';
var halt = 1;
var appmodules = ['emitter','filter','loadbalancer','trilaterator','aggregator'];
var livemodules = [];
var frontendClients = [];

// Functions
function initDatabase (callback) {
	pool.query('drop database if exists '+mariadb.db, function(err, result){
		if (err) callback(err);
		pool.query('create database '+mariadb.db, function(err){
			if (err) callback(err);
			pool.query('create table '+mariadb.db+'.messages (id int not null auto_increment, uid varchar(40) not null, lat double, lon double, timestamp int, primary key (id))', function(err){
				if (err) callback(err);
			});
		});
	});
}

function filterRequests(payload){
		try {
		data = JSON.parse(payload);
    } catch (e) {
        l.error('Received not valid JSON.\r\n'+payload);
		return false;
    }
	var requestingNode = data.node;
	var requestingNodeName = data.name;
	if (requestingNode != mynodeid) {
		switch(data.request) {
			case 'ready':
				if (livemodules.length < appmodules.length) {
					var alpha = -1;
					var beta = 0
					for(var i = 0; i < appmodules.length; i++){
						alpha = appmodules.indexOf(requestingNodeName);
						if (alpha > -1) {
							for(var ii = 0; ii < livemodules.length; ii++){
								if (livemodules[ii].name == requestingNodeName) {
									beta = 1;
								}
							}
						}
					}
					if (alpha > -1 && beta == 0) {
						if (requestingNodeName == 'trilaterator') {
							livemodules.push({"node":requestingNode,"pid":data.pid,"name":requestingNodeName});
							mqttmod.send(broker,requestingNode+'/'+data.pid+'/control',readyresponse);
						} else {
							livemodules.push({"node":requestingNode,"name":requestingNodeName});
							mqttmod.send(broker,requestingNode+'/control',readyresponse);
						}
						l.info('Node '+requestingNode+' reported that is ready');
						l.info('Informing the new nodes that local node is ready');
						console.log(livemodules);
					} 
					if (alpha > -1 && beta == 1) {
						l.info('A '+requestingNodeName+' node already exists');
					}
					if (alpha == -1) {
						l.info(requestingNodeName+' node is not valid');
					}
				}
				if (livemodules.length == appmodules.length) {
					if (halt == 1) {
						mqttmod.send(broker,previousnodebroadcasttopic,execresponse);
						halt = 0;
						l.info('All modules ready');
						l.info('Starting application');
					}
					if (requestingNodeName == 'trilaterator' && halt == 0) {
						for(var i = 0; i < livemodules.length; i++){
								if (livemodules[i].name == requestingNodeName && livemodules[i].node == requestingNode && livemodules[i].pid != data.pid) {
									mqttmod.send(broker,requestingNode+'/'+data.pid+'/control',readyresponse);
								}	
						}
					}
				}
			break;
			case 'terminating':
				for(var i = 0;i < livemodules.length;i++){ 
					if (livemodules[i].name == requestingNodeName && livemodules[i].node == requestingNode) { 
						switch(requestingNodeName) {
							case 'trilaterator':
								if ( data.pid == livemodules[i].pid) {
									livemodules.splice(i,1);
								}
							break;
							default:
								livemodules.splice(i,1);
						}
						console.log('livemodules');
						console.log(livemodules);
					}
				}
				if (livemodules.length < appmodules.length) {
					l.info('Node '+requestingNode+' reported that is terminating, halt application.');
					halt = 1;
				}
			break;
			default:
				l.info('Didn\'t receive a valid request');
		}
	}
}

//start the server to send data to the frontend clients, in batches, starting from the oldest timestamp
//Since the DB may be empty, the server will only send data when it retrieves a record with the minimum timestamp
function startOutServer(clients){
	console.log('Inside the out server');
	var firstTimestamp = 0;
	var interval = setInterval(function(){
		getFirstTimestamp(function(err, timestamp){	
			if (err || timestamp <=0){
				l.info('Trying to get the timestamp of the first record.');
			} else {
				firstTimestamp = timestamp;
				l.info('Got firstTimestamp: '+firstTimestamp);
				clients.forEach(function(client){
					if (client.currentTimestamp < firstTimestamp){
						client.currentTimestamp = firstTimestamp;
					}
				});
				clearInterval(interval);
			}
		});
	},rate_reconnect);

	var outserver = require('./outserver');
	outserver.init(30114, function(state){
		let clientId = state.connectionId;
		let data = state.payload;
		let connection = state.connection;
		clients[clientId] = clients[clientId] || {};
		let client = clients[clientId];
		let currentTimestamp = client.currentTimestamp;
		
		l.info('Got client\'s timestamp: '+currentTimestamp);
		
		switch(state.statusText){			
			case 'error':
				l.error(data);
				client.currentTimestamp = firstTimestamp;
				break;
			case 'message': 
				if (halt == 0) {
					heapCheck();
					if (currentTimestamp == 0){
						l.info('Client\'s timestamp is 0 or null.');
						break;
					}
					try{
						let from = parseInt(currentTimestamp);
						let to = parseInt(currentTimestamp)+parseInt(data.step);
						l.info('Getting all data between '+from+' and '+to+' timestamp.');
						pool.query('select * from '+mariadb.db+'.messages where timestamp >= '+from+' and timestamp <'+to,  (err,rows) => {	
						if (err) {
							console.log(err);
							l.error(err.message);
						} else {
							l.info('Sending data to client');
							outserver.send(rows,connection,l);
						}
						l.info('To is '+to);
						});
						client.currentTimestamp=to;
					} catch(e){
						l.error(e);
					}
				}
				break;
			case 'terminated':
				client.currentTimestamp = firstTimestamp;
				break;
			case 'connected': 
				clients[clientId] = {'connectionState':state,'currentTimestamp':firstTimestamp};
				break;
		}
	},l);
}

//function to get the oldest record
function getFirstTimestamp(callback){
	var firstTimestamp = 0;
	l.info('Trying to get the firsttimestamp');
	pool.query('select timestamp from '+mariadb.db+'.messages order by timestamp limit 1',  (err,row) => {	
		if (err) {
			l.error(err.message);
			callback(err);
			return;
		} else {
			if (row.length == 1) {
				firstTimestamp = row[0].timestamp;
				l.info('Found timestamp: '+firstTimestamp);
				callback(null,firstTimestamp);
			}
		}
	});
}

function heapCheck () {
	var usage = '';
	const used = process.memoryUsage();
	for (let key in used) {
		usage = usage.concat(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB, `);
		if (key == 'external') {
			usage=usage.slice(0, -2);
			l.info('Heap usage: '+usage);
		}
	}
}

// Begin execution
initDatabase (function(err){
	if (err){
		l.error('Error while initializing DB: '+err);
		l.info('Exiting now.');
		process.exit(1);
	}
});
livemodules.push({"node":mynodeid,"name":"aggregator"});

// Start webserver
staticServer.init(l);
startOutServer(frontendClients);

// Start recieving control MQTT messages
l.info('Started recieving control MQTT messages on '+controltopic+'.');
mqttmod.receive(broker,controltopic,filterRequests);	

// Start recieving control MQTT messages
l.info('Started receiving control messages on '+pipelinetopic);
mqttmod.receive(broker,pipelinetopic,filterRequests);

// Inform previous node that you are ready
mqttmod.send(broker,pipelinetopic,readyresponse);

process.on('SIGTERM', function onSigterm () {
	l.info('Got SIGTERM');
	mqttmod.send(broker,pipelinetopic,terminatingresponse);
});