'use strict';

exports.desc = 'App related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('app')
		.option('path', {
			alias: 'p',
			type: 'string',
			desc: 'Path to a Homey App directory',
			default: process.cwd(),
		})
		.demandCommand()
		.help()	
}