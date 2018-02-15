'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {
	
	onInit() {
		this.log('MyApp is running...');
	}
	
}

module.exports = MyApp;