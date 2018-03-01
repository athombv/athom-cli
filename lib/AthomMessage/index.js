'use strict';

const config = require('../../config.js');
const Log = require('../..').Log;
const Settings = require('../..').Settings;
const fetch = require('node-fetch');
const colors = require('colors');
const Table = require('cli-table');

const CACHE_HOURS = 12;

class AthomMessage {
	
	async notify() {
		
		try {
			let now = new Date();
			let lastCheck = await Settings.get('athomMessageLastCheck');
			if( lastCheck === null ) {
				lastCheck = new Date(2018, 1, 14);
			} else {
				lastCheck = new Date(lastCheck);
			}
					
			let hours = Math.abs(now - lastCheck) / 36e5;
			if( hours > CACHE_HOURS ) {
	
				let res = await fetch(config.athomMessageUrl, { timeout: 1000 });
				if( !res.ok ) return;
				
				let json = await res.json();
				
				await Settings.set('athomMessageCached', json.message);
				await Settings.set('athomMessageLastCheck', now.toString());
			
			}
		
		} catch( err ) {}
		
		return this._showMessage();
	
	}
	
	async _showMessage() {
		try {
			let message = await Settings.get('athomMessageCached');
			if( message ) {
				
				message = AthomMessage.formatMessage(message);
				
				let table = new Table();
					table.push([ message ]);
				Log( table.toString() );
			}
		} catch( err ) {}
	}
	
	static formatMessage( message ) {
		message = message.split(' ');
		message = message.map((word, i) => {
			if( (i+1) % 7 === 0 ) return `${word}\n`;
			return `${word} `;
		}).map( word => colors.cyan(word));
		message = message.join('');
		return message;
	}
	
}

module.exports = AthomMessage;