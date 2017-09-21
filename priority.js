var incidents;

function getParameterByName(name) {
    name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
    var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results === null ? null : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function secondsToHHMMSS(seconds) {
	var hours = Math.floor(seconds / 60 / 60);
	var minutes = Math.floor((seconds % 3600) / 60);
	var seconds = seconds % 60;

	var HH = ('0' + hours).slice(-2);
	var MM = ('0' + minutes).slice(-2);
	var SS = ('0' + seconds).slice(-2);

	return `${HH}:${MM}:${SS}`;
}

function PDRequest(token, endpoint, method, options) {

	if ( !token ) {
		alert("Please put a token in the URL, like .../index.html?token=<YOUR_V2_API_TOKEN>");
		return;
	}

	var merged = $.extend(true, {}, {
		type: method,
		dataType: "json",
		url: "https://api.pagerduty.com/" + endpoint,
		headers: {
			"Authorization": "Token token=" + token,
			"Accept": "application/vnd.pagerduty+json;version=2"
		},
		error: function(err, textStatus) {
			$('.busy').hide();
			var alertStr = "Error '" + err.status + " - " + err.statusText + "' while attempting " + method + " request to '" + endpoint + "'";
			try {
				alertStr += ": " + err.responseJSON.error.message;
			} catch (e) {
				alertStr += ".";
			}

			try {
				alertStr += "\n\n" + err.responseJSON.error.errors.join("\n");
			} catch (e) {}

			alert(alertStr);
		}
	},
	options);

	$.ajax(merged);
}

function fetch(endpoint, params, callback, progressCallback) {
	var limit = 100;
	var infoFns = [];
	var fetchedData = [];

	var commonParams = {
			total: true,
			limit: limit
	};

	var getParams = $.extend(true, {}, params, commonParams);

	var options = {
		data: getParams,
		success: function(data) {
			var total = data.total;
			Array.prototype.push.apply(fetchedData, data[endpoint]);

			if ( data.more == true ) {
				var indexes = [];
				for ( i = limit; i < total; i += limit ) {
					indexes.push(Number(i));
				}
				indexes.forEach(function(i) {
					var offset = i;
					infoFns.push(function(callback) {
						var options = {
							data: $.extend(true, { offset: offset }, getParams),
							success: function(data) {
								Array.prototype.push.apply(fetchedData, data[endpoint]);
								if (progressCallback) {
									progressCallback(data.total, fetchedData.length);
								}
								callback(null, data);
							}
						}
						PDRequest(getParameterByName('token'), endpoint, "GET", options);
					});
				});

				async.parallel(infoFns, function(err, results) {
					callback(fetchedData);
				});
			} else {
				callback(fetchedData);
			}
		}
	}
	PDRequest(getParameterByName('token'), endpoint, "GET", options);
}

function fetchIncidents(since, until, callback, progressCallback) {
	var params = {
		since: since.toISOString(),
		until: until.toISOString(),
		'statuses[]': 'resolved',
		'include[]': 'first_trigger_log_entries'
	}
	fetch('incidents', params, callback, progressCallback);
}

function fetchReportData(since, until, callback) {
	var progress = {
		incidents: {
			total: 0,
			done: 0
		},
		log_entries: {
			total: 0,
			done: 0
		}
	};

	fetchIncidents(since, until, function(data) {
		callback(data);
	},
	function(total, done) {
		progress.incidents.total = total;
		progress.incidents.done = done;
		progress_percent = Math.round(( progress.incidents.done + progress.log_entries.done ) / ( progress.incidents.total + progress.log_entries.total ) * 100);
		$('#progressbar').attr("aria-valuenow", "" + progress_percent);
		$('#progressbar').attr("style", "width: " + progress_percent + "%;");
		$('#progressbar').html("" + progress_percent + "%");
	});
}

function buildReport(since, until, reuseFetchedData) {
	$('.busy').show();

	async.series([
		function(callback) {
			if ( reuseFetchedData ) {
				callback(null, 'yay');
			} else {
				PDRequest(getParameterByName('token'), 'priorities', 'GET', {
					success: function(data) {
						$('#priority-checkboxes-div').html('Show priorities: <div class="btn-group" id="priority-checkboxes-group"></div>');
	
						data.priorities.forEach(function(priority) {
							$('#priority-checkboxes-group').append($('<button/>', { class: "priority-button btn btn-primary active", value: priority.name, text: priority.name }));
						});
						$('#priority-checkboxes-group').append($('<button/>', { class: "priority-button btn", value: "~none~", text: "none" }));
	
						$('.priority-button').click(function() {
							$(this).toggleClass('btn-primary');
							$(this).toggleClass('active');
							buildReport(since, until, true);
						});
						callback(null, 'yay');
					}
				});
			}
		},
		function(callback) {
			if ( reuseFetchedData ) {
				callback(null, 'yay');
			} else {
				fetchReportData(since, until, function(data) {
					incidents = data;
					callback(null, 'yay');
				});
			}
		}
	],
	function(err, results) {
		var sinceStr = moment(since).format("LLLL");
		var untilStr = moment(until).format("LLLL");

		var headline = `Incidents occurring between ${sinceStr} and ${untilStr}`;
		$('#details').html('<h3>' + headline + '</h3>');

		$('#details').append($('<table/>', {
			id: "details-table",
			class: "display"
		}));

		var tableData = [];
		
		var selected_priorities = $(':button.active').map(function() { return this.value; }).get();
		console.log(selected_priorities);
		
		incidents.forEach(function(incident) {
			if ( ! incident.priority ) {
				incident.priority = { name: '~none~' };
			}

			if ( selected_priorities.indexOf(incident.priority.name) > -1 ) {
				tableData.push([
					'<a href="' + incident.html_url + '" target="blank">' + incident.incident_number + '</a>',
					incident.title,
					incident.priority.name,
					moment(incident.created_at).format('l LTS [GMT]ZZ'),
					incident.first_trigger_log_entry.agent.summary,
					moment(incident.last_status_change_at).format('l LTS [GMT]ZZ'),
					incident.last_status_change_by.summary,
					secondsToHHMMSS(moment.duration(moment(incident.last_status_change_at).diff(moment(incident.created_at))).asSeconds()),
					incident.service.summary,
				]);
			}
		});

		var columnTitles = [
				{ title: "#" },
				{ title: "Title" },
				{ title: "Priority" },
				{ title: "Created at" },
				{ title: "Created by" },
				{ title: "Resolved at" },
				{ title: "Resolved by" },
				{ title: "Duration" },
				{ title: "Service Name" }
			];
		$('#details-table').DataTable({
			data: tableData,
			columns: columnTitles,
			dom: 'Bfrtip',
			buttons: [
				'copy', 'csv', 'pdf', 'print'
			],
			order: [[2, 'asc']],
			pageLength: 50
		});

		$('.busy').hide();
	});
}

function main() {
	$('#since').datepicker();
	$('#until').datepicker();

	if (getParameterByName('hideControls') == 'true') {
		$('#controls').hide();
	}

	var until = new Date();
	var since = new Date();
	since.setDate(since.getDate() - 7);

	since.setHours(0,0,0,0);
	until.setHours(23,59,59,999);

	$('#since').datepicker("setDate", since);
	$('#until').datepicker("setDate", until);

	buildReport(since, until);

	$('#since').change(function() {
		since = $('#since').datepicker("getDate");
		since.setHours(0,0,0,0);

		buildReport(since, until);
	});

	$('#until').change(function() {
		until = $('#until').datepicker("getDate");
		until.setHours(23,59,59,999);

		buildReport(since, until);
	});
}

$(document).ready(main);
