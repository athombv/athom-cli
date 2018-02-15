'use strict';

const Log = require('../../..').Log;
const AthomApi = require('../../..').AthomApi;
const colors = require('colors');

exports.desc = 'Select a Homey as active';
exports.builder = yargs => {
	yargs
		.option('id', {
			alias: 'i',
			desc: 'ID of the Homey',
			type: 'string',
		})
		.option('name', {
			alias: 'n',
			desc: 'Name of the Homey',
			type: 'string',
		})
}

exports.handler = async ( yargs ) => {
	
	try {
		await AthomApi.selectActiveHomey({
			id: yargs.id,
			name: yargs.name
		});
	} catch( err ) {
		Log(colors.red(err.message || err.toString()));
	}

};