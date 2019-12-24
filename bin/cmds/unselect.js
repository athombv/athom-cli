'use strict';

const Log = require('../../index').Log;
const AthomApi = require('../../index').AthomApi;

exports.desc = 'Unselect the active Homey';
exports.handler = async () => {

	try {
		await AthomApi.unselectActiveHomey();
	} catch( err ) {
		Log(err);
	}

}