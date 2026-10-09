/**
 * @fileoverview A program for the launcher test: it prints the arguments it was started with.
 */

process.stdout.write(JSON.stringify(process.argv.slice(2)));
