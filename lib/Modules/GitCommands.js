'use strict'

const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const exec = promisify(require('child_process').exec);
const statAsync = promisify( fs.stat );
const gitConfigParser = require('parse-git-config');

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
     * Check if the cwd is contains a git repo.
     * @returns Boolean wether or not .git has been detected.
     */
    async isGitRepo() {
        if( await statAsync( path.join(this.path, '.git' ) ) ) return true;
        return false;
    }

    /**
     * Check if the repository containts uncommitted changes
     * @returns Boolean, true if there are uncomitted changes detected.
     */
    async hasUncommitedChanges() {
        const result = await this._executeGitCommand('status');
        if (typeof result === 'string' && result.includes('not staged')) return true;
        return false;
    }

    /**
     * Create a git tag with the given version number and optional message.
     * @param{Object{version, message}} Version: Used for the tagname, message: The message to describe the tag.
     * @returns Git output or error when the command failed.
     *  */
    async createTag ({version, message}) {
        if (typeof version === 'string' && typeof message === 'string') {
            try {
                if (!version || version === '')
                    throw new Error('✖ A version is required to create a tag.');
                if (await this.hasUncommitedChanges())
                    throw new Error('✖ Please commit your changes to Git first.');

                const result = await this._executeGitCommand(`tag -a "v${version}" -m "${message}"`);

                if (result.hasOwnProperty('stderr') && result.stderr.includes('already'))
                    throw new Error('✖ This Git tag already exists!');
            } catch (error) {
                throw error;
            }
        }
        else {
            throw new Error('Invalid type received');
        }
    }

    /**
     * Obtain all the tags from the given repository.
     * @returns Array with git tags.
     *  */
    async getTags() {
        const output = await this._executeGitCommand(`tag -l`);

        // Create an array based on line breaks, then filter any empty String out of it.
        return output.split(/\r\n|\r|\n/).filter(value => {
            if (value) return value;
        });
    }

    /**
     * Deletes a tag from the given repository.
     * @param version version string to delete
     * @returns Output from @_executeGitCommand
     *  */
    async deleteTag(version) {
        if (typeof version === 'string') return this._executeGitCommand(`tag -d ${version}`);
        return new Error('Invalid type received');
    }


    /**
     * Commit a given file.
     * @param {Object {file, message}} File: the file to commit, message: Commit message
     * @returns Output from @_executeGitCommand
     */
    async commitFile({file, message}) {
        if (typeof file === 'string' && typeof message === 'string') {
          return this._executeGitCommand(`commit -o ${file} -m "${message}"`);
        }
        return new Error('Invalid type received');
    }

    async push() {
        const gitConfig = await gitConfigParser({ path: path.join(this.path, '.git', 'config') });
        // Always push to remote origin by default to prevent complicated configs.
        if ( !gitConfig.hasOwnProperty('remote "origin"') ) {
          throw new Error('✖ Cannot push to remote: \`remote "origin"\` not found in Git config.');
        }
        return this._executeGitCommand('git push');
    }

    /**
     * Function to exectue git commands.
     * @param command: Git command to execute, eg commit, tag, push etc.
     * @returns Git command output or error when command failed.
     *  */
    async _executeGitCommand(command) {
        if (! await this.isGitInstalled())
            throw new Error('git_not_installed');

        try {
            const { stdout, stderr } = await exec(`git ${command}`, { cwd: this.path });
            return stdout;
        } catch(error) {
          throw error;
        }
    }
}

module.exports = GitCommands;