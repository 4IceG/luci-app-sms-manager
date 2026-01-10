'use strict';
'require dom';
'require form';
'require fs';
'require ui';
'require uci';
'require view';

/*
	Copyright 2022-2026 Rafał Wabik - IceG - From eko.one.pl forum

	Licensed to the GNU General Public License v3.0.
*/

return view.extend({
	ussdSessionActive: false,
	
	handleCommand: function(exec, args) {
		let buttons = document.querySelectorAll('.cbi-button');

		for (let i = 0; i < buttons.length; i++)
			buttons[i].setAttribute('disabled', 'true');

		return fs.exec(exec, args).then(function(res) {
			let out = document.querySelector('.ussdcommand-output');
			let fullhistory = document.getElementById('history-full')?.checked;
			let reversereplies = document.getElementById('reverse-replies')?.checked;
			out.style.display = '';

			res.stdout = res.stdout?.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, "") || '';
			res.stderr = res.stderr?.replace(/^(?=\n)$|^\s*|\s*$|\n\n+/gm, "") || '';

			if (res.stdout === undefined || res.stderr === undefined || res.stderr.includes('undefined') || res.stdout.includes('undefined')) {
				return;
			} else {
				let ussdResponse = '';
				let sessionState = 'idle';
				
				try {
					if (res.stdout.includes('state:') || res.stdout.includes('3GPP USSD')) {
						let stateMatch = res.stdout.match(/state:\s*'([^']*)'/);
						let responseMatch = res.stdout.match(/network (?:notification|request):\s*'([^']*)'/);
						
						if (stateMatch) {
							sessionState = stateMatch[1];
						}
						if (responseMatch) {
							ussdResponse = responseMatch[1];
						}
					} else if (res.stdout.includes('"response"') || res.stdout.includes('"state"')) {
						let jsonMatch = res.stdout.match(/\{[\s\S]*\}/);
						if (jsonMatch) {
							let jsonData = JSON.parse(jsonMatch[0]);
							if (jsonData.response) {
								ussdResponse = jsonData.response;
							}
							if (jsonData.state) {
								sessionState = jsonData.state;
							}
						}
					} else {
						ussdResponse = res.stdout;
					}
					this.ussdSessionActive = (sessionState === 'user-response' || sessionState === 'active');
					if (this.ussdSessionActive && fullhistory) {
						ussdResponse += '\n\n[Sesja USSD aktywna - możesz wysłać odpowiedź]';
					}
					
				} catch(e) {
					ussdResponse = res.stdout;
					this.ussdSessionActive = false;
				}

				let cut = res.stderr;
				if ( cut.length > 2 ) {
					if (cut.includes('error'))
						ussdResponse = _('Error sending USSD code. Please check modem status.');
					if (cut.includes('GDBus.Error'))
						ussdResponse = _('ModemManager error. Please check if modem is available.');
					if (cut.includes('No modems'))
						ussdResponse = _('No modem found. Please check ModemManager.');
						
					dom.content(out, [ res.stderr || '', ussdResponse ? ' > ' + ussdResponse : '' ]);
				} else {
					if ( fullhistory ) {
						const ussdreply = ussdResponse.replace(/^\s*\n+/g, '');
						let ussdv = document.getElementById('cmdvalue');
						ussdv.value = '';
						document.getElementById('cmdvalue').focus();
						if (reversereplies) {
							out.innerText = ussdreply + (out.innerText.trim() ? '\n\n' + out.innerText : '');
						} else {
							out.innerText += '\n\n' + ussdResponse;
							out.innerText = out.innerText.replace(/^\s*\n+/g, '');
						}
					} else {
						dom.content(out, [ ussdResponse || '' ]);
					}
				}
			}
		}.bind(this)).catch(function(err) {
			ui.addNotification(null, E('p', [ err ]));
		}).finally(function() {
			for (let i = 0; i < buttons.length; i++)
				buttons[i].removeAttribute('disabled');
		});
	},

	handleGo: function(ev) {
		let ussd = document.getElementById('cmdvalue').value;
		let sections = uci.sections('sms_manager');
		let modemPath = sections[0].ussdport;
		let fullhistory = document.getElementById('history-full')?.checked;

		if ( ussd.length < 1 ) {
			ui.addNotification(null, E('p', _('Please specify the code to send')), 'info');
			return false;
		}

		if ( !modemPath ) {
			ui.addNotification(null, E('p', _('Please set the modem for communication')), 'info');
			return false;
		}
		let modemNum = modemPath.split('/').pop();
		if (this.ussdSessionActive && fullhistory) {
			return this.handleCommand('/usr/bin/mmcli', [ '-m', modemNum, '--3gpp-ussd-respond=' + ussd ]);
		} else {
			return this.handleCommand('/usr/bin/mmcli', [ '-m', modemNum, '--3gpp-ussd-initiate=' + ussd ]);
		}
	},

	handleClear: function(ev) {
		let out = document.querySelector('.ussdcommand-output');
		out.style.display = '';
		out.style.display = 'none';

		let fullhistory = document.getElementById('history-full')?.checked;

		if ( fullhistory ) {
			dom.content(out, [ '' ]);
		}

		let ov = document.getElementById('cmdvalue');
		ov.value = '';
		if (this.ussdSessionActive) {
			let sections = uci.sections('sms_manager');
			let modemPath = sections[0].ussdport;
			if (modemPath) {
				let modemNum = modemPath.split('/').pop();
				fs.exec('/usr/bin/mmcli', [ '-m', modemNum, '--3gpp-ussd-cancel' ]);
				this.ussdSessionActive = false;
			}
		}

		document.getElementById('cmdvalue').focus();
	},
	
	handleClearOut: function(ev) {
		let out = document.querySelector('.ussdcommand-output');
		let fullhistory = document.getElementById('history-full')?.checked;

		if ( fullhistory ) {
			out.style.display = '';
			out.style.display = 'none';
			dom.content(out, [ '' ]);
			document.getElementById("reverse-replies").disabled = false;
			document.getElementById("reverse-replies").checked = true;
		} else {
			document.getElementById("reverse-replies").disabled = true;
			document.getElementById("reverse-replies").checked = false;
			if (this.ussdSessionActive) {
				let sections = uci.sections('sms_manager');
				let modemPath = sections[0].ussdport;
				if (modemPath) {
					let modemNum = modemPath.split('/').pop();
					fs.exec('/usr/bin/mmcli', [ '-m', modemNum, '--3gpp-ussd-cancel' ]);
					this.ussdSessionActive = false;
				}
			}
		}
	},

	handleCopy: function(ev) {
		let out = document.querySelector('.ussdcommand-output');
		let fullhistory = document.getElementById('history-full')?.checked;

		if ( !fullhistory ) {
			out.style.display = 'none';
		}

		let ov = document.getElementById('cmdvalue');
		ov.value = '';
		let x = document.getElementById('tk').value;
		ov.value = x;
	},

	load: function() {
		return Promise.all([
			L.resolveDefault(fs.read_direct('/etc/modem/sms_manager_ussdcodes.user'), null),
			uci.load('sms_manager')
		]);
	},

	render: function (loadResults) {

	let info = _('User interface for sending USSD codes using ModemManager.');

		return E('div', { 'class': 'cbi-map', 'id': 'map' }, [
				E('h2', {}, [ _('USSD Codes') ]),
				E('div', { 'class': 'cbi-map-descr'}, info),
				E('hr'),
				E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('User USSD codes') ]),
							E('div', { 'class': 'cbi-value-field' }, [
									E('select', { 'class': 'cbi-input-select',
										'id': 'tk',
										'style': 'margin:5px 0; width:100%;',
										'change': ui.createHandlerFn(this, 'handleCopy'),
										'mousedown': ui.createHandlerFn(this, 'handleCopy')
									},
									(loadResults[0] || "").trim().split("\n").map(function(cmd) {
                                        let fields = cmd.split(/;/);
                                        let name = fields[0];
                                        let code = fields[1] || fields[0];
                                        return E('option', { 'value': code }, name );
                                    })
								)
							]) 
						]),
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('Code to send') ]),
							E('div', { 'class': 'cbi-value-field' }, [
							E('input', {
								'style': 'margin:5px 0; width:100%;',
								'type': 'text',
								'id': 'cmdvalue',
								'data-tooltip': _('Press [Enter] to send the code, press [Delete] to delete the code'),
								'keydown': function(ev) {
									if (ev.keyCode === 13) {
										let execBtn = document.getElementById('execute');
										if (execBtn) {
											execBtn.click();
											}
									}
									if (ev.keyCode === 46) {
										let del = document.getElementById('cmdvalue');
										if (del) {
											let ov = document.getElementById('cmdvalue');
											ov.value = '';
											document.getElementById('cmdvalue').focus();
										}
									}
								}
								}),
							])
						]),

					])
				]),
			E('div', { 'class': 'right' }, [
				E('label', { 'class': 'cbi-checkbox' }, [
					E('input', {
						'id': 'history-full',
						'click': ui.createHandlerFn(this, 'handleClearOut'),
						'data-tooltip': _('Check this option to enable interactive USSD mode for menu navigation'),
						'type': 'checkbox',
						'name': 'showhistory',
						'disabled': null
					}), ' ',
					E('label', { 'for': 'history-full' }), ' ',
					_('Keep the previous reply when sending a new USSD code.')
				]),
				'\xa0\xa0\xa0',
				E('label', { 'class': 'cbi-checkbox' }, [
					E('input', {
						'id': 'reverse-replies',
						'data-tooltip': _('View new reply from top'),
						'type': 'checkbox',
						'name': 'reversereplies',
						'disabled': true
					}), ' ',
					E('label', { 'for': 'reverse-replies' }), ' ',
					_('Turn over the replies.')
				])
			]),
				E('hr'),
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'cbi-button cbi-button-remove',
						'id': 'clr',
						'click': ui.createHandlerFn(this, 'handleClear')
					}, [ _('Clear form') ]),
					'\xa0\xa0\xa0',
					E('button', {
						'class': 'cbi-button cbi-button-action important',
						'id': 'execute',
						'click': ui.createHandlerFn(this, 'handleGo')
					}, [ _('Send code') ]),
				]),
				E('p', _('Reply')),
				E('pre', { 'class': 'ussdcommand-output', 'style': 'display:none; border: 1px solid var(--border-color-medium); border-radius: 5px; font-family: monospace' }),

			]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
