'use strict';

exports.desc = 'Flow related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('flow')
		.demandCommand()
		.help()	
}