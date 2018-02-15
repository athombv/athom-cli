'use strict';

const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;

exports.desc = 'Log out the current user';
exports.handler = async yargs => {
		
	try {
		await AthomApi.logout();				
	} catch( err ) {
		Log(err);
	}

}