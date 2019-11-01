'use strict';

const pkg = require('../package.json');
const yargs = require('yargs');
const updateNotifier = require('update-notifier');
const AthomMessage = require('..').AthomMessage;

(async () => {
	
	await AthomMessage.notify();
	updateNotifier({ pkg }).notify({
		isGlobal: true,
	});
	
	yargs
		.commandDir('./cmds')
		.demandCommand()
		.strict()
		.help()	
		.argv;

})();