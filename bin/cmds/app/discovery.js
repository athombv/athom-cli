'use strict';

exports.desc = 'Discovery related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('discovery')
		.demandCommand()
		.help()	
}