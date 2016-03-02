var path		= require('path');

var express		= require('express');
var bodyParser	= require('body-parser');
var open		= require("open");
var portfinder	= require('portfinder');
var Api			= require('athom-api');

module.exports.login = function( callback ) {
	
	portfinder.getPort(function (err, port) {
	
		if( err ) throw err;
	
		var app = express();
		
		app
			.use('/', express.static( path.join( __dirname, '..', 'www') ) )
			.post('/', bodyParser.json(), function(req, res){
				
				// respond
				res.send('ok');
				
				// save tokens
				global.settings.token = req.body;
				global.api = new Api({}, global.settings.token);
				
				module.exports.refresh(function(){
					
					// say hi
					console.log("Welcome, " + global.settings.me.firstname + '! You are now logged in on this computer.');
					
					if( typeof callback == 'function' ) {
						callback();
					}
					
				});
			})
			.listen(port);
		
		// open browser
		var address = "http://localhost:" + port;
		console.log("Opening browser at " + address);
		open(address);
	
	});
	
}

module.exports.logout = function(){
	delete global.settings.accessToken;
	delete global.settings.refreshToken;
	delete global.settings.me;
	delete global.settings.homey;
	console.log("You are now logged out")
	setTimeout(process.exit, 1000);
}

module.exports.refresh = function( callback ){
	
	if( typeof global.settings.token == 'undefined' ) return console.error("please login first".red);
				
	// get user info
	global.api.get('/user/me', function(err, body, statusCode){
		if( err ) throw( err );
		
		// save user info
		global.settings.me = body;
	
		// callback
		if( typeof callback == 'function' ) {
			callback();
		} else {
			setTimeout(process.exit, 1000);
		}
	});
	
}