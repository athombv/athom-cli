#!/usr/bin/env node

var fs			= require('fs');
var path		= require('path');

var program		= require('commander');
var colors		= require('colors');
var request		= require('request');
var semver		= require('semver');
var Api			= require('athom-api');

// Initialize lib
var lib = global.lib = {
	settings	: require('./lib/settings'),
	user		: require('./lib/user'),
	homey		: require('./lib/homey'),
	project		: require('./lib/project'),
	ledring		: require('./lib/ledring')
}

// Initialize config
var config = global.config = require('./config.json');

// Initialize API
var api = global.api = new Api({
	client_id		: global.config.ATHOM_API_CLIENT_ID,
	client_secret	: global.config.ATHOM_API_CLIENT_SECRET
}, global.settings.token);

// save token whenr refreshed
api.on('refresh', function(token){
	global.settings.token = token;
})

// Get package info
var pjson = require( path.join(__dirname, 'package.json') );

// Check if latest version
// if updated, remove
if( global.settings.updateAvailable && semver.gte( pjson.version, global.settings.updateAvailable ) ) {
	delete global.settings.updateAvailable;
	delete global.settings.updateAvailableLastChecked;
}

if( global.settings.updateAvailable ) {
	console.log(("There is an update available! Run `npm install -g " + pjson.name + "` to update.").yellow.italic);
} else if(
	!global.settings.updateAvailableLastChecked ||
	!((new Date) - new Date(global.settings.updateAvailableLastChecked) < 1000 * 60 * 60)
) {

	request({
		url	: 'http://registry.npmjs.org/' + pjson.name + '/latest',
		json: true
	}, function(err, result, body){
		if( err ) return;

		try {
			if( semver.gt(body.version, pjson.version ) ) {
				global.settings.updateAvailable = body.version;
			}
			global.settings.updateAvailableLastChecked = new Date();
		} catch( err ) {

		}
	})

}

// Check if message from Athom
if( global.settings.messageAvailable ) {
	console.log((global.settings.messageAvailable).cyan.italic);
}

if(
	!global.settings.messageAvailableLastChecked ||
	!((new Date) - new Date(global.settings.messageAvailableLastChecked) < 1000 * 60 * 60)
) {

	request({
		url	: 'https://homey-static.athom.com/etc/athom-cli.json',
		json: true
	}, function(err, result, body){
		console.log(err, body)
		if( err ) return;

		if( body && body.message ) {
			global.settings.messageAvailable = body.message;
		} else {
			global.settings.messageAvailable = false;
		}

		global.settings.messageAvailableLastChecked = new Date();
	})

}

program
	.version(pjson.version)

program
	.command('login')
	.description('login to your Athom account')
	.action(function(){
		lib.user.login(function(){
			setTimeout(process.exit, 1000);
		});
	})

program
	.command('logout')
	.description('logout of your Athom account')
	.action(lib.user.logout)

program
	.command('project')
	.description('run `athom project --help` to view homey commands')
	.option('--create [path]', "create a new Homey app")
	.option('--run [path]', "run a Homey app")
	.option('--run-clean [path]', "run a Homey app without previous settings")
	.option('--install [path]', "install a Homey app")
	.option('--validate [path]', "validate a Homey app")
	.option('--validate-app-store [path]', "validate a Homey app")
	.action(function(options){
		if( options.create )					lib.project.create(options.create);
		if( options.run )						lib.project.run(options.run);
		if( options.runClean )					lib.project.runClean(options.run);
		if( options.install )					lib.project.install(options.install);
		if( options.validate )					lib.project.validate(options.validate);
		if( options.validateAppStore )			lib.project.validateAppStore(options.validateAppStore);
	})

program
	.command('homey')
	.description('run `athom homey --help` to view homey commands')
	.option('--list', 'list your Homeys')
	.option('--list-local', 'list your USB-connected Homeys')
	.option('--select', 'select active Homey')
	.option('--unselect', 'clear active Homey')
	.action(function(options){
		if( options.list )			lib.homey.list( true );
		if( options.listLocal )		lib.homey.listLocal( true );
		if( options.select )		lib.homey.select(true);
		if( options.unselect )		lib.homey.unselect();
	})

program
	.command('ledring')
	.description('run `athom ledring --help` to view homey commands')
	.option('--run [path]', "run a ledring animation app")
	.action(function(options){
		if( options.run )		lib.ledring.run(options.run);
	})

program
	.parse(process.argv);

if (!process.argv.slice(2).length) {
	program.outputHelp();
}