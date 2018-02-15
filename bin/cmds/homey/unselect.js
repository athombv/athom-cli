'use strict';

const Log = require('../../..').Log;
const AthomApi = require('../../..').AthomApi;

exports.desc = 'Unselect the active Homey';
exports.handler = async () => {
		
	try {
		await AthomApi.unselectActiveHomey();				
	} catch( err ) {
		Log(err);
	}

}