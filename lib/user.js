var path		= require('path');

var express		= require('express');
var bodyParser	= require('body-parser');
var open		= require("open");
var portfinder	= require('portfinder');
var Api			= require('athom-api');
var inquirer	= require('inquirer');

module.exports.login = function( callback ) {
	
	inquirer.prompt([
		{
			type: "input",
			name: "username",
			message: "Athom E-mail"
		},
		{
			type: "password",
			name: "password",
			message: "Athom Password"
		},
	], function(answers){
				
		global.api.getPasswordToken( answers.username, answers.password, function( err, token ){
			if( err ) return console.error( err.error_description || err.toString() );
			
			global.settings.token = token;
				
			module.exports.refresh(function(){
				
				// say hi
				console.log("Welcome, " + global.settings.me.firstname + '! You are now logged in on this computer.');
				
				if( typeof callback == 'function' ) {
					callback();
				}
				
			});
		})
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
		if( err ) return callback(err);
		
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