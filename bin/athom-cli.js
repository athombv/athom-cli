'use strict';

const pkg = require('../package.json');
const yargs = require('yargs');
const updateNotifier = require('update-notifier');
const AthomMessage = require('..').AthomMessage;

(async () => {
	
	await AthomMessage.notify();
	updateNotifier({ pkg }).notify();
	
	yargs
		.commandDir('./cmds')
		.demandCommand()
		.help()	
		.argv;

})();