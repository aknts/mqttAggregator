//var l = require('./logger');
var http = require('http');
var fs = require('fs');
var path = require('path');
var staticServer = {
	init: function(l){
		//l.debug('Inside init function.');
		http.createServer(function (request, response) {
		    l.info('Static Server: New request arrived: '+request.url);

		    var filePath = '.' + request.url;
		    if (filePath == './')
		        filePath = __dirname+'/index.html';

		    var contentType = 'text/html';

		    fs.readFile(filePath, function(error, content) {
		        if (error) {
		        	response.writeHead(400);
		        	response.end('Sorry, some sort of error occured: '+error.code+' ..\n');
		        	response.end(); 
		        }
		        else {
		            response.writeHead(200, { 'Content-Type': contentType });
		            response.end(content, 'utf-8');
		        }
		    });
		}).listen(30080);
	l.info('Static server running at port 80');
	},
};
module.exports = staticServer;
