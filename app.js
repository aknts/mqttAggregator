// [Starting banner]
console.log('Code start.');
console.log('Test app for realying mqtt messages between topics.');

// [Settings]
// Configuration settings
//var getconfig = process.argv[2];
//var argconfig = JSON.parse(getconfig);
//console.log(argconfig);
var config = JSON.parse(Buffer.from(require('./config.js'), 'base64').toString());
console.log(config);
console.log(config.broker);
console.log(config.rxtopic);
console.log(config.txtopic);
// [Libraries]
const l = require('mqttlogger');
var mqttmod = require('mqttmod');

// [Functions]
function sendToNext(msg){
        console.log(msg);
        mqttmod.send(config.broker,config.txtopic,msg,finalizeSending);
}

function finalizeSending() {
        l.log('INFO','Data sent to heatmap');
}

// [Execution]
mqttmod.receive(config.broker,config.rxtopic,sendToNext);

// [Ending banner]
console.log('Code end');
