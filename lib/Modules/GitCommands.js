'use strict'

const util = require('util');
const exec = util.promisify(require('child_process').exec);

class GitCommands {
    constructor(appPath) {
        this.path = appPath || process.cwd();
    }

    /**
     * Check if git is installed. By using --version git will not exit with an error code
     */
    async isGitInstalled() {
        try {
            const {stdout, stderr} = await exec('git --version');
            
            return stdout ? true : false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Returns true when unstaged files are detected.
     */
    async hasUncommitedChanges() {
        const result = await this._executeGitCommand('status');
        if (typeof(result) === 'string' && result.includes('not staged')) return true;
        return false;
    }

    // Create a git tag with the given version number and optional message.
    async createTag (version) {
        try {
            if (!version || version === '') 
                throw new Error('A version is required to create a tag.');
            if (await this.hasUncommitedChanges())
                throw new Error('Please commit changes first!');

            const result = await this._executeGitCommand(`tag -a "${version}"`);

            if (result.hasOwnProperty('stderr') && result.stderr.includes('already')) 
                throw new Error('This Git tag already exists!');
        } catch (error) {
            throw error;
        }
    }

    // Obtain all the tags from the given repository
    async getTags() {
        const output = await this._executeGitCommand(`tag -l`);

        // Create an array based on line breaks, then filter any empty String out of it.
        return output.split(/\r\n|\r|\n/).filter(value => {
            if (value) return value;
        });
    }

    // Deletes a tag from the given repository
    async deleteTag(version) {
        return this._executeGitCommand(`tag -d ${version}`);
    }

    // Function to exectue git commands.
    async _executeGitCommand(command) {
        if (! await this.isGitInstalled())
            throw new Error('git_not_installed');

        try {
            const { stdout, stderr } = await exec(`git ${command}`, { cwd: this.path });
            return stdout;
        } catch(error) { return error; }
    }
}

module.exports = GitCommands;