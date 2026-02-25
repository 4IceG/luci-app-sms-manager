'use strict';
'require dom';
'require form';
'require fs';
'require ui';
'require uci';
'require view';

/*
	Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum
	
	Licensed to the GNU General Public License v3.0.
*/

return view.extend({
	viewName: 'sms_manager_sendat',

	restoreSettingsFromLocalStorage: function() {
		try {
			let selectedFile = localStorage.getItem('luci-app-' + this.viewName + '-selectedFile');
			return selectedFile;
		} catch(e) {
			console.error('localStorage not available:', e);
			return null;
		}
	},

	saveSettingsToLocalStorage: function(fileName) {
		try {
			localStorage.setItem('luci-app-' + this.viewName + '-selectedFile', fileName);
		} catch(e) {
			console.error('localStorage not available:', e);
		}
	},

	handleCommand: function(exec, args) {
		let buttons = document.querySelectorAll('.cbi-button');

		for (let i = 0; i < buttons.length; i++)
			buttons[i].setAttribute('disabled', 'true');
			
		return fs.exec(exec, args).then(function(res) {
			let out = document.querySelector('.atcommand-output');
			out.style.display = '';

			res.stdout = res.stdout?.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, "") || '';
			res.stderr = res.stderr?.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, "") || '';
			
			if (res.stdout === undefined || res.stderr === undefined || res.stderr.includes('undefined') || res.stdout.includes('undefined')) {
				return;
			}
			else {
				let output = res.stdout || '';
				let match = output.match(/response:\s*'([^']*)'/);
				if (match && match[1]) {
					output = match[1];
				}
				
				dom.content(out, [ output, res.stderr || '' ]);
			}
			
		}).catch(function(err) {
			ui.addNotification(null, E('p', [ err ]));
		}).finally(function() {
			for (let i = 0; i < buttons.length; i++)
				buttons[i].removeAttribute('disabled');
		});
	},

	handleGo: function(ev) {
		let atcmd = document.getElementById('cmdvalue').value;
		let sections = uci.sections('sms_manager');
		let modemPath = sections[0].atport;

		if ( atcmd.length < 2 )
		{
			ui.addNotification(null, E('p', _('Please specify the command to send')), 'info');
			return false;
		}
		
		if ( !modemPath )
		{
			ui.addNotification(null, E('p', _('Please set the modem for communication')), 'info');
			return false;
		}
		let modemNum = modemPath.split('/').pop();
		return this.handleCommand('/usr/bin/mmcli', [ '-m' , modemNum , '--command=' + atcmd ]);
	},

	handleClear: function(ev) {
		let out = document.querySelector('.atcommand-output');
		out.style.display = 'none';

		let ov = document.getElementById('cmdvalue');
		ov.value = '';

		document.getElementById('cmdvalue').focus();
	},

	handleCopy: function(ev) {
		let out = document.querySelector('.atcommand-output');
		out.style.display = 'none';

		let ov = document.getElementById('cmdvalue');
		ov.value = '';
		let x = document.getElementById('tk').value;
		ov.value = x;
	},

	handleFileChange: function(ev) {
		let selectedFile = ev.target.value;
		let selectElement = document.getElementById('tk');

		if (!selectElement || !selectedFile) return;

		this.saveSettingsToLocalStorage(selectedFile);

		return fs.read_direct('/etc/modem/sms_manager_atcmmds/' + selectedFile).then(function(content) {
			selectElement.innerHTML = '';

			let commands = (content || '').trim().split('\n');
			commands.forEach(function(cmd) {
				if (cmd.trim()) {
					let fields = cmd.split(/;/);
					let name = fields[0];
					let code = fields[1] || fields[0];
					let option = document.createElement('option');
					option.value = code;
					option.textContent = name;
					selectElement.appendChild(option);
				}
			});

			let cmdInput = document.getElementById('cmdvalue');
			if (cmdInput) cmdInput.value = '';
		}).catch(function(err) {
			console.error('Error loading AT commands file:', err);
			ui.addNotification(null, E('p', _('Error loading AT commands file: ') + selectedFile), 'error');
		});
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(fs.read_direct('/etc/modem/sms_manager_atcmmds.user'), null),
			L.resolveDefault(fs.list('/etc/modem/sms_manager_atcmmds'), []),
			uci.load('sms_manager')
		]);
	},

	render: function (loadResults) {

		let info = _('User interface for sending AT commands using ModemManager.');

		let atFiles = loadResults[1] || [];
		let userFiles = atFiles.filter(function(file) {
			return file.type === 'file' && file.name && file.name.match(/\.user$/);
		});

		let savedFile    = this.restoreSettingsFromLocalStorage();
		let fileToLoad   = userFiles.length > 0 ? userFiles[0].name : null;
		let checkedIndex = 0;

		if (savedFile && userFiles.length > 0) {
			let foundIndex = userFiles.findIndex(function(f) { return f.name === savedFile; });
			if (foundIndex !== -1) {
				fileToLoad   = savedFile;
				checkedIndex = foundIndex;
			}
		}

		if (fileToLoad) {
			setTimeout(function() {
				L.resolveDefault(fs.read_direct('/etc/modem/sms_manager_atcmmds/' + fileToLoad), '').then(function(content) {
					let selectElement = document.getElementById('tk');
					if (!selectElement) return;
					selectElement.innerHTML = '';
					(content || '').trim().split('\n').forEach(function(cmd) {
						if (!cmd.trim()) return;
						let fields = cmd.split(/;/);
						let option = document.createElement('option');
						option.value       = fields[1] || fields[0];
						option.textContent = fields[0];
						selectElement.appendChild(option);
					});
				}).catch(function(err) {
					console.error('Error loading initial AT commands file:', err);
				});
			}, 100);
		}

		return E('div', { 'class': 'cbi-map', 'id': 'map' }, [
			E('h2', {}, [ _('AT Commands') ]),
			E('div', { 'class': 'cbi-map-descr' }, info),
			E('hr'),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-node' }, [

					(function() {
						if (userFiles.length > 0) {
							return E('div', { 'class': 'cbi-value' }, [
								E('label', { 'class': 'cbi-value-title' }, [ _('Defined AT command files') ]),
								E('div', { 'class': 'cbi-value-field' },
									E('div', {},
										userFiles.map(function(file, index) {
											let fileName    = file.name;
											let displayName = fileName.replace(/\.user$/, '').toUpperCase();
											return E('label', {
												'style':        'margin-right: 15px;',
												'data-tooltip': _('Select file with AT commands to load')
											}, [
												E('input', {
													'type':    'radio',
													'name':    'at_file',
													'value':   fileName,
													'change':  ui.createHandlerFn(this, 'handleFileChange'),
													'checked': index === checkedIndex ? true : null
												}),
												' ', displayName
											]);
										}.bind(this))
									)
								)
							]);
						} else {
							return E('div');
						}
					}.bind(this))(),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('User AT commands') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', {
								'class':     'cbi-input-select',
								'id':        'tk',
								'style':     'margin:5px 0; width:100%;',
								'change':    ui.createHandlerFn(this, 'handleCopy'),
								'mousedown': ui.createHandlerFn(this, 'handleCopy')
							},
							(function() {
								if (userFiles.length > 0) {
									return [ E('option', { 'value': '' }, _('Loading...')) ];
								}
								let content = loadResults[0] || '';
								if (!content.trim()) {
									return [ E('option', { 'value': '' }, _('No AT commands available')) ];
								}
								return content.trim().split('\n').map(function(cmd) {
									if (!cmd.trim()) return null;
									let fields = cmd.split(/;/);
									return E('option', { 'value': fields[1] || fields[0] }, fields[0]);
								}).filter(function(o) { return o !== null; });
							})()
							)
						])
					]),

					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Command to send') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'style':        'margin:5px 0; width:100%;',
								'type':         'text',
								'id':           'cmdvalue',
								'data-tooltip': _('Press [Enter] to send the command, press [Delete] to delete the command'),
								'keydown': function(ev) {
									if (ev.keyCode === 13) {
										let execBtn = document.getElementById('execute');
										if (execBtn) execBtn.click();
									}
									if (ev.keyCode === 46) {
										let ov = document.getElementById('cmdvalue');
										if (ov) {
											ov.value = '';
											document.getElementById('cmdvalue').focus();
										}
									}
								}
							})
						])
					])

				])
			]),
			E('hr'),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'cbi-button cbi-button-remove',
					'id':    'clr',
					'click': ui.createHandlerFn(this, 'handleClear')
				}, [ _('Clear form') ]),
				'\xa0\xa0\xa0',
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'id':    'execute',
					'click': ui.createHandlerFn(this, 'handleGo')
				}, [ _('Send command') ])
			]),
			E('p', _('Reply')),
			E('pre', {
				'class': 'atcommand-output',
				'style': 'display:none; border: 1px solid var(--border-color-medium); border-radius: 5px; font-family: monospace'
			})
		]);
	},

	handleSaveApply: null,
	handleSave:      null,
	handleReset:     null
});
