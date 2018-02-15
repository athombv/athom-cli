'use strict';

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;

exports.desc = 'Log in with an Athom Account';
exports.handler = async yargs => {
		
	try {
		await AthomApi.login();				
	} catch( err ) {
		Log(err);
	}

}