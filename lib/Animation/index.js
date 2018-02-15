'use strict';

const path = require('path');
const Log = require('../..').Log;
const AthomApi = require('../..').AthomApi;
const colors = require('colors');

class Animation {
	
	constructor( path ) {
		this._path = path;
		this._exiting = false;
		this._session = null;
	}
	
	async run() {
		
		let animation;
		try {
			animation = require(this._path);
		} catch( err ) {
			try {
				animation = require( path.join( process.cwd(), this._path ) );
			} catch( err ) {
				throw new Error(err.stack);
			}
		}
		
		let homey = await AthomApi.getActiveHomey();
		
		Log(colors.green(`✓ Starting LED Ring Animation...`));
		this._session = await homey.devkit.startLedringAnimation({ animation });
		Log(colors.green(`✓ LED Ring Animation successfully started...`));
		
		// set interval to keep running
		setInterval(() => {}, 1000);
		
		process.on('SIGINT', this._onSigint.bind(this));
		
	}
	
	async _onSigint() {
		if( this._exiting ) return;
			this._exiting = true;
		
		Log(colors.green(`✓ Stopping LED Ring Animation...`));
		
		try {
			let activeHomey = await AthomApi.getActiveHomey();
			await activeHomey.devkit.stopLedringAnimation({
				animationId: this._session.animation_id
			});
		} catch( err ) {}
		
		Log(colors.green(`✓ LED Ring Animation successfully stopped`));
		
		process.exit();
		
	}
	
}

module.exports = Animation;