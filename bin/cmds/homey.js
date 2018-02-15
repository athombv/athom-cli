'use strict';

exports.desc = 'Homey related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('homey')
		.demandCommand()
		.help()	
;
}