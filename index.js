// Modules
var request = require('request'); 		// https://github.com/request/request
var Promise = require('bluebird');		// http://bluebirdjs.com/docs/getting-started.html
var diff 	= require('deep-diff');		// https://www.npmjs.com/package/deep-diff
var nodemailer = require('nodemailer'); // https://github.com/nodemailer/nodemailer
var fs 		= require('fs');

// Credentials
var emailRecepient  = "whoTo@gmail.com",
	etouchAccountId = "ACCOUNT_ID",
 	etouchApiKey 	= "API_KEY",
 	etouchEventId 	= "EVENT_ID",
 	accessToken 	= "";

 var smtpOptions = {
 	service : "Gmail",
 	auth : {
 		user : "yourEmail@gmail.com",
 		pass : "yourPassword"
 	}
 };

 var transporter = nodemailer.createTransport(smtpOptions);

 var mailOptions = {
 	from : "yourEmail@gmail.com",
 	to : emailRecepient,
 	subject : "eTouches Schedule Updates",
 	text : "",
 	html : ""
 };

// Settings
var etouchURL = "https://www.eiseverywhere.com/api/v2/"
	newSessionList = [],
	oldSessionList = [],
	newSessionMap = {},
	oldSessionMap = {},
	firstPull 	   = true,
	testMode	   = false,
	c_TIMEBETWEENPULLS = 60000, // 1 minute
	emailMsg	   = "",
	htmlMsg		   = "";


// Get Access Token from eTouches
var getAccessToken = function(url, accountId, apiKey) {
	return new Promise(function(resolve, reject) {
		if(!url || !accountId || !apiKey) {
			reject("Missing parameters");
		}
		url += `global/authorize.json?accountid=${accountId}&key=${apiKey}`;
		request(url, function(error, response, body) {
			if (!error && response.statusCode === 200) {
				var jsonBody = JSON.parse(body);
				accessToken = jsonBody.accesstoken;
				resolve(jsonBody.accesstoken);
			}
			reject(error);
		});
	});
};

// Get the session list from eTouches
var getFullSessionList = function(url, token, eventId) {
	return new Promise(function(resolve, reject) {
		if(!url || !token || !eventId) {
			reject("Missing parameters");
		}
		url += `ereg/listSessions.json?accesstoken=${token}&eventid=${eventId}`;
		request(url, function(error, response, body) {
			if (!error && response.statusCode === 200) {						
				resolve(JSON.parse(body));
			}
			reject(error);
		});
	});
};

// Filter relevant fields from session list array
var findRelevantFields = function(sessions) {
	return new Promise(function(resolve, reject) {
		if(sessions.length === 0) {
			reject(sessions);
		}
		newSessionMap = {};
		newSessionList = [];
		var filteredSessions = sessions.map(function(session) {
			return {
				sessionid : session.sessionid,
				sessionkey : session.sessionkey,
				name : session.name,
				sessiondate : session.sessiondate,
				starttime : session.starttime,
				endtime : session.endtime
			};
		}).sort(function(a, b) {
			return parseFloat(a.sessionid) - parseFloat(b.sessionid);
		});

		filteredSessions.forEach(function(session){
			newSessionMap[session.sessionid] = session;
		});

		newSessionList = filteredSessions;	
		if(firstPull) {
			oldSessionList = filteredSessions;
			oldSessionMap = newSessionMap;
		}
		
		if(testMode && !firstPull) {
			oldSessionList = [];
			oldSessionMap = {};
			oldSessionList = JSON.parse(fs.readFileSync('./firstPull.txt')).sort(function(a, b) {
				return parseFloat(a.sessionid) - parseFloat(b.sessionid);
			});
			oldSessionList.forEach(function(session) {
				oldSessionMap[session.sessionid] = session;
			});
		}
		resolve(filteredSessions);
	});
};

// Compare session lists
var compareSessionsLists = function(recentSessionList) {
	return new Promise(function(resolve, reject) {
		var diffObj = diff(oldSessionList, recentSessionList);
		if(firstPull && testMode) {
			fs.writeFile('firstPull.txt', JSON.stringify(oldSessionList), function() {});			
		}		
		if(!diffObj){
			firstPull = false;
			reject("No differences detected");
		}		
		resolve();
	});
};

// Analyze the differences
var analyzeDifferences = function() {
	return new Promise(function(resolve, reject) {
		var editsMsg = "Edited Sessions:\n",
			newMsg 	 = "New Sessions:\n",
			deleteMsg = "Deleted Sessions:\n",
			editsFlag = false,
			newFlag  = false,
			deleteFlag = false;

		// Loop through old sessions to see if there are any CHANGED or DELETED sessions
		oldSessionList.forEach(function(oldSession) {
			// New List has this ID, check if changed
			if(newSessionMap[oldSession.sessionid]){
				var diffEdits = diff(oldSession, newSessionMap[oldSession.sessionid]);
				if(diffEdits) {					
					diffEdits.forEach(function(edit) {
						if(edit.kind === "E") {
							editsFlag = true;
							editsMsg += `Session: ${oldSession.sessionid}; Field: ${edit.path[0]}; ${edit.lhs} changed to ${edit.rhs}\n`;
						} else if (edit.kind === "D") {
							editsFlag = true;
							editsMsg += `Session: ${oldSession.sessionid}; Field: ${edit.path[0]}; ${edit.lhs} was deleted\n`;
						} else if (edit.kind === "N") {
							editsFlag = true;
							editsMsg += `Session: ${oldSession.sessionid}; Field: ${edit.path[0]}; ${edit.rhs} was added\n`;
						} else {
							console.log("ERROR: Old and New Sessions objects do not match");
						}
					});
				}
			}
			// Session has now been deleted 
			else {
				deleteFlag = true;
				deleteMsg += `Session ${oldSession.sessionid}: ${oldSession.name}: has been deleted.\n`;
			}
		});

		// Loop through new sessions to see if there are any ADDED sessions
		newSessionList.forEach(function(newSession) {
			if(oldSessionMap[newSession.sessionid]) {}
			else {
				newFlag = true;
				newMsg += `Session ${newSession.sessionid}: ${newSession.name}: has been added.\n`;
			}
		});

		var currentDate = new Date();
		emailMsg = `Changes from ${currentDate.getHours()}:${currentDate.getMinutes()} ${currentDate.toDateString()}:\n`;
		htmlMsg = `<h1>${emailMsg}</h1>`;
		if(editsFlag){
			emailMsg += editsMsg + '\n\n';
			htmlMsg += `<div>${editsMsg}</div>\n\n`;
		}
		if(newFlag) {
			emailMsg += newMsg + '\n\n';
			htmlMsg += `<div>${newMsg}</div>\n\n`;
		}
		if(deleteFlag) {
			emailMsg += deleteMsg + '\n';
			htmlMsg += `<div>${deleteMsg}</div>\n\n`;
		}
		resolve(emailMsg);
	});
};

// Send email to recipient
var sendEmail = function(message) {
	return new Promise(function(resolve, reject) {
		mailOptions.html = htmlMsg;
		mailOptions.text = message;
		 transporter.sendMail(mailOptions, function(err, response) {
		 	if(err) {
		 		reject(err);
		 	} else {
		 		console.log("Sent email about changes");
		 		resolve();
		 	}
		 });
	});
};

// Reset Old/New sessions objects
var resetObjects = function() {
	return new Promise(function(resolve, reject) {
		oldSessionList = [];
		oldSessionMap = {};
		oldSessionList = newSessionList;
		oldSessionMap  = newSessionMap;
		resolve();
	});	
};

// Boot up the application
var bootApplication = function() {
	console.log("booting application");
	beginAction();
	setTimeout(bootApplication, c_TIMEBETWEENPULLS);
};

// Begin Action
var beginAction = function() {
	getAccessToken(etouchURL, etouchAccountId, etouchApiKey)
	.then(function(token) {		
		return getFullSessionList(etouchURL, token, etouchEventId);
	}).then(function(sessions) {
		return findRelevantFields(sessions);
	}).then(function(filteredSessions) {
		return compareSessionsLists(filteredSessions);
	}).then(function() {
		return analyzeDifferences();		
	}).then(function(msg){
		return sendEmail(msg);
	}).then(function() {
		return resetObjects();
	})
	.catch(function(err) {
		console.log(err);
	});
};

bootApplication();