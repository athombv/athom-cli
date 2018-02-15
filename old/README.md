# Athom CLI

This package enables you to **create** and **run** Homey apps from the command line.

Install it globally on your system (might require sudo):

`$ npm install -g athom-cli`

## Usage
**Login first:**

`$ athom login`

**Create a new app**

`$ athom project --create`

**Run the new app** *(from within your app folder)*

`$ athom project --run`

**View your Homeys**

`$ athom homey --list`

**Select a single Homey as active**

*Your active Homey will automatically be used for running apps*

`$ athom homey --select`

**See what else is possible:**

`$ athom --help`
