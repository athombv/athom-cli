'use strict';

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const colors = require('colors');

exports.desc = 'Log out the current user';
exports.handler = async yargs => {

	try {
		await AthomApi.logout();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}