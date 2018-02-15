'use strict';

const config = require('../../config.js');
const fetch = require('fetch');
const Settings = require('../..').Settings;

class AthomMessage {
	
	constructor() {
		this._init().catch(console.error)
	}
	
	async _init() {
		
		let now = new Date();
		let lastCheck = await Settings.get('athomMessageLastCheck');
		if( lastCheck === null ) lastCheck = new Date(2018, 1, 14);
		
		console.log(lastCheck)
		
		let hours = Math.abs(now - lastCheck) / 36e5;
		if( hours < 12 ) return;
		
		console.log('checking for updates');
//		if( lastCheck < )
		
		console.log('lastCheck', hours)
//		if( lastCheck === null )
	
	}
	
}

module.exports = AthomMessage;