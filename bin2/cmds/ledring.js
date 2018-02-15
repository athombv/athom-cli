'use strict';

exports.desc = 'LED ring related commands';
exports.builder = yargs => {
	return yargs
		.commandDir('ledring')
		.option('path', {
			alias: 'p',
			type: 'string',
			desc: 'Path to an animation file',
		})
		.demandCommand()
		.help()
}