'use strict';

const path = require('path');
const Log = require('../../..').Log;
const Animation = require('../../..').Animation;
const colors = require('colors');

exports.desc = 'Play a LED Ring animation on Homey';
exports.handler = async yargs => {
	
	try {
		let animation = new Animation( yargs.path );
		await animation.run();
	} catch( err ) {
		Log(colors.red(err.message));
	}

}