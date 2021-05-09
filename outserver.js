//convenience object to log events
//var l = require('./logger');

var server = {
	clients:[],
	clientCounter:0,
	init: function(port, callback, l){
		var clientId = 0;

		var that = this;

		var WebSocketServer = require('websocket').server;
		var http = require('http');

		var server = http.createServer(function(request, response) {
			l.info('Received request for ' + request.url + '.');
			response.writeHead(404);
			response.end();
		});

		server.listen(port, function() { 
			l.info('Server is listening on port ' + port + '.');
		});

		// create the server
		wsServer = new WebSocketServer({
			httpServer: server,
			autoAcceptConnections: false
		});

		wsServer.on('request', function(request) {
 
			l.info('Connection requested from: ' + request.remoteAddress + '.');

			// accept connection
			var connection = request.accept(null, request.origin); 		
			// we need to know the clients' index to remove them on 'close' event
			var index = that.clients.push(connection) - 1;
			var clientId = that.clientCounter++;

			var remoteAddress = connection.remoteAddress;
			l.info('Connection accepted from client: ' +remoteAddress+ '. The client is assigned the id: '+clientId);
			l.info('Number of clients currently connected: ' + that.clients.length + '.');

			connection.on('error', function(error) {
				callback({'statusText':'error','payload':error,'connection':connection,'connectionId':clientId});
			});

			connection.on('message',function(message){
				callback({'statusText':'message','payload':JSON.parse(message.utf8Data),'connection':connection,'connectionId':clientId});
			});

			connection.on('close', function(connection) {
				// close user connection
				l.info('A client with ip: ' + remoteAddress + ' and id: ' + clientId + ' was disconnected.');
				// remove user from the list of connected clients
				that.clients.splice(index, 1);
				l.info('Number of clients currently connected: ' + that.clients.length + '.');

				callback({'statusText':'terminated','payload':null,'connection':connection,'connectionId':clientId});
			});

			callback({'statusText':'connected','payload':null,'connection':connection,'connectionId':clientId});
		});
	},

	send: function(message, connection, l){
		l.info('Sending in UTF back to web client');
		connection.sendUTF(JSON.stringify(message));
	},
};

module.exports = server;