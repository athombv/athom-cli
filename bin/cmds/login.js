'use strict';

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const colors = require('colors');

exports.desc = 'Log in with an Athom Account';
exports.handler = async yargs => {

	try {
		await AthomApi.login();
		process.exit();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}