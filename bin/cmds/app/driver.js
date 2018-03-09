'use strict';

exports.desc = 'Driver related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('driver')
		.demandCommand()
		.help()	
}