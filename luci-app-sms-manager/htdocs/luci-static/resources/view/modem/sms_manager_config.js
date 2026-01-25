'use strict';
'require form';
'require fs';
'require view';
'require uci';
'require ui';
'require rpc';
'require tools.widgets as widgets'

/*
	Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum

	Licensed to the GNU General Public License v3.0.
*/

var pkg = {
    get Name() { return 'mailsend'; },
    get URL()  { return 'https://openwrt.org/packages/pkgdata/' + this.Name + '/'; },
    get pkgMgrURINew() { return 'admin/system/package-manager'; },
    get pkgMgrURIOld() { return 'admin/system/opkg'; },
    bestPkgMgrURI: function () {
        return L.resolveDefault(
            fs.stat('/www/luci-static/resources/view/system/package-manager.js'), null
        ).then(function (st) {
            if (st && st.type === 'file')
                return 'admin/system/package-manager';
            return L.resolveDefault(fs.stat('/usr/libexec/package-manager-call'), null)
                .then(function (st2) {
                    return st2 ? 'admin/system/package-manager' : 'admin/system/opkg';
                });
        }).catch(function () { return 'admin/system/opkg'; });
    },
    openInstallerSearch: function (query) {
        let self = this;
        return self.bestPkgMgrURI().then(function (uri) {
            let q = query ? ('?query=' + encodeURIComponent(query)) : '';
            window.open(L.url(uri) + q, '_blank', 'noopener');
        });
    },
    checkPackages: function() {
        return fs.exec_direct('/usr/bin/opkg', ['list-installed'], 'text')
            .catch(function () {
                return fs.exec_direct('/usr/libexec/opkg-call', ['list-installed'], 'text')
                    .catch(function () {
                        return fs.exec_direct('/usr/libexec/package-manager-call', ['list-installed'], 'text')
                            .catch(function () {
                                return '';
                            });
                    });
            })
            .then(function (data) {
                data = (data || '').trim();
                return data ? data.split('\n') : [];
            });
    },
    _isPackageInstalled: function(pkgName) {
        return this.checkPackages().then(function(installedPackages) {
            return installedPackages.some(function(pkg) {
                return pkg.includes(pkgName);
            });
        });
    }
};

return view.extend({
	load: function() {
		return L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-L', '-J']), null)
			.then(function(res) {
				var modems = [];
				
				if (res) {
					try {
						var data = JSON.parse(res);
						
						if (data && data['modem-list'] && Array.isArray(data['modem-list'])) {
							data['modem-list'].forEach(function(modem) {
								if (modem) {
									var modemPath = modem;
									var modemNum = modemPath.split('/').pop();
									
									modems.push({
										path: modemPath,
										index: modemNum,
										name: 'Modem ' + modemNum,
										displayName: 'ModemManager Modem ' + modemNum
									});
								}
							});
						}
					} catch (e) {
						console.error('Error parsing ModemManager data:', e);
					}
				}
				
				return modems;
			})
			.catch(function(err) {
				console.error('Error modem detect:', err);
				return [];
			});
	},

	render: function(modems) {
		let m, s, o;
		m = new form.Map('sms_manager', _('Configuration SMS Manager'), _('Configuration panel for SMS Manager application.'));

		s = m.section(form.TypedSection, 'sms_manager', '', null);
		s.anonymous = true;

		//TAB SMS

		s.tab('smstab' , _('SMS Settings'));
		s.anonymous = true;

		o = s.taboption('smstab' , form.ListValue, 'readport', _('SMS reading modem'), 
			_('Select one of the available modems from ModemManager.'));
		
		modems.sort(function(a, b) {
			return a.index > b.index ? 1 : -1;
		});
		
		modems.forEach(function(modem) {
			o.value(modem.path, modem.displayName);
		});

		o.placeholder = _('Please select a modem');
		o.rmempty = false;

		o = s.taboption('smstab', form.Value, 'bnumber', _('Phone number to be blurred'),
		_('The last 5 digits of this number will be blurred.')
		);
		o.password = true;

		o = s.taboption('smstab', form.Flag, 'information', _('Explanation of number and prefix'),
		_('In the tab for sending SMSes, show an explanation of the prefix and the correct phone number.')
		);
		o.rmempty = false;

		o = s.taboption('smstab', form.Button, '_fsave');
		o.title = _('Save messages to a text file');
		o.description = _('This option allows to backup SMS messages or, for example, save messages that are not supported by ModemManager.');
		o.inputtitle = _('Save as .txt file');
		o.onclick = function() {
			return uci.load('sms_manager').then(function() {
				let modemPath = (uci.get('sms_manager', '@sms_manager[0]', 'readport'));
				
				if (!modemPath) {
					ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info');
					return;
				}
				
				let modemNum = modemPath.split('/').pop();
				
				L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
					.then(function(listRes) {
						if (!listRes) {
							ui.addNotification(null, E('p', {}, _('No SMS messages found on modem')), 'info');
							return;
						}
						
						let smsIds = [];
						let matches = listRes.matchAll(/\/SMS\/(\d+)/g);
						for (let match of matches) {
							smsIds.push(match[1]);
						}
						
						if (smsIds.length === 0) {
							ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info');
							return;
						}
						
						let smsPromises = smsIds.map(function(smsId) {
							return L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-s', smsId]), null);
						});
						
						Promise.all(smsPromises).then(function(smsResults) {
							let allSmsText = '';
							let currentDate = new Date();
							let validSmsCount = 0;
							
							smsResults.forEach(function(smsRes, index) {
								if (smsRes) {
									let output = smsRes;
									let number = '';
									let text = '';
									let timestamp = '';
									
									let numberMatch = output.match(/number:\s*(.+?)$/m);
									if (numberMatch) {
										number = numberMatch[1].trim();
									}
									
									let textMatch = output.match(/text:\s*([\s\S]+?)(?=\n\s*-{2,}|\n\s*Properties)/);
									if (textMatch) {
										text = textMatch[1]
											.split('\n')
											.map(function(line) {
												return line.replace(/^\s*\|?\s*/, '').trim();
											})
											.filter(function(line) { return line.length > 0; })
											.join(' ')
											.trim();
									}
									
									let timeMatch = output.match(/timestamp:\s*(?:'([^']+)'|(\S+))/);
									if (timeMatch) {
										timestamp = (timeMatch[1] || timeMatch[2] || '').trim();
										let fixedTimestamp = timestamp.replace(/([+-]\d{2})$/, '$1:00');
										try {
											let date = new Date(fixedTimestamp);
											if (date && !isNaN(date.getTime())) {
												timestamp = date.getFullYear() + '-' + 
													String(date.getMonth() + 1).padStart(2, '0') + '-' + 
													String(date.getDate()).padStart(2, '0') + ' ' +
													String(date.getHours()).padStart(2, '0') + ':' + 
													String(date.getMinutes()).padStart(2, '0');
											}
										} catch(e) {
											// old timestamp
										}
									}
									
									if (number && text) {
										validSmsCount++;
										allSmsText += 'From: ' + number + '\n';
										allSmsText += 'Date: ' + (timestamp || 'Unknown') + '\n';
										allSmsText += 'Message: ' + text + '\n';
										allSmsText += '\n';
									}
								}
							});
							
							if (validSmsCount === 0) {
								ui.addNotification(null, E('p', {}, _('No valid SMS messages to save')), 'info');
								return;
							}
							
							fs.write('/tmp/mysms_manager.txt', allSmsText);
							let fileName = 'mysms_manager.txt';
							let filePath = '/tmp/' + fileName;

							fs.stat(filePath).then(function () {
								if (confirm(_('Save ' + validSmsCount + ' SMS messages to txt file?'))) {
									L.resolveDefault(fs.read_direct('/tmp/mysms_manager.txt'), null).then(function (restxt) {
										if (restxt) {
											L.ui.showModal(_('Saving...'), [
												E('p', { 'class': 'spinning' }, _('Please wait.. Process of saving SMS messages to a text file is in progress.'))
											]);
											let link = E('a', {
												'download': 'mysms_manager.txt',
												'href': URL.createObjectURL(
												new Blob([ restxt ], { type: 'text/plain' })),
											});
											window.setTimeout(function() {
												link.click();
												URL.revokeObjectURL(link.href);
												L.hideModal();
											}, 2000);
										} else {
											ui.addNotification(null, E('p', {}, _('Saving SMS messages to a file failed. Please try again')));
										}
									}).catch(function(err) {
										ui.addNotification(null, E('p', {}, _('Download error: ') + err.message));
									});
								}
							});
						}).catch(function(err) {
							ui.addNotification(null, E('p', {}, _('Error reading SMS messages: ') + err.message));
						});
					})
					.catch(function(err) {
						ui.addNotification(null, E('p', {}, _('Error listing SMS: ') + err.message));
					});
			});
		};

		o = s.taboption('smstab', form.Button, '_fdelete');
		o.title = _('Delete all messages');
		o.description = _("This option allows you to delete all SMS messages when they are not visible in the 'Received Messages' tab.");
		o.inputtitle = _('Delete all');
		o.onclick = function() {
			if (confirm(_('Delete all the messages?'))) {
				return uci.load('sms_manager').then(function() {
					let modemPath = (uci.get('sms_manager', '@sms_manager[0]', 'readport'));
					
					if (!modemPath) {
						ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info');
						return;
					}
					
					let modemNum = modemPath.split('/').pop();
					
					L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
						.then(function(listRes) {
							if (!listRes) {
								ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info');
								return;
							}
							
							let smsIds = [];
							let matches = listRes.matchAll(/\/SMS\/(\d+)/g);
							for (let match of matches) {
								smsIds.push(match[1]);
							}
							
							if (smsIds.length === 0) {
								ui.addNotification(null, E('p', {}, _('No SMS messages found')), 'info');
								return;
							}
							
							let deletePromises = smsIds.map(function(smsId) {
								return fs.exec('/usr/bin/mmcli', ['-m', modemNum, '--messaging-delete-sms=' + smsId]);
							});
							
							Promise.all(deletePromises).then(function() {
								uci.set('sms_manager', '@sms_manager[0]', 'sms_count', '0');
								return uci.save().then(function() {
									return uci.apply();
								}).then(function() {
									ui.addNotification(null, E('p', {}, _('All messages deleted successfully')), 'info');
								});
							}).catch(function(err) {
								ui.addNotification(null, E('p', {}, _('Error deleting messages: ') + err.message), 'error');
							});
						});
				});
			}
		};

		o = s.taboption('smstab', form.ListValue, 'sendport', _('SMS sending modem'), 
			_("Select one of the available modems from ModemManager."));
		
		modems.sort(function(a, b) {
			return a.index > b.index ? 1 : -1;
		});
		
		modems.forEach(function(modem) {
			o.value(modem.path, modem.displayName);
		});

		o.placeholder = _('Please select a modem');
		o.rmempty = false;

        o = s.taboption('smstab', form.Value, 'pnumber', _('Phone number prefix'),
	        _("Country prefix for phone numbers (for Poland it is +48)."));
        o.default = '+48';
        o.validate = function(section_id, value) {
	        if (value.match(/^\+?[0-9]+$/))
		        return true;
	        return _('Expected format: +decimal value or decimal value');
        };

		o = s.taboption('smstab', form.Flag, 'prefix', _('Add prefix to phone number'),
		_('Automatically add prefix to the phone number field.')
		);
		o.rmempty = false;
		//o.default = true;

		o = s.taboption('smstab', form.Flag, 'sendingroup', _('Enable group messaging'),
		_("This option allows you to send one message to all contacts in the user's contact list."));
		o.rmempty = false;
		o.default = false;

		o = s.taboption('smstab', form.TextValue, '_tmp2', _('User contacts'),
			_("Each line must have the following format: 'Contact name;phone number'. For user convenience, the file is saved to the location <code>/etc/modem/sms_manager_phonebook.user</code>."));
		o.rows = 7;
		o.cfgvalue = function(section_id) {
			return fs.trimmed('/etc/modem/sms_manager_phonebook.user');
		};
		o.write = function(section_id, formvalue) {
			return fs.write('/etc/modem/sms_manager_phonebook.user', formvalue.trim().replace(/\r\n/g, '\n') + '\n');
		};

		//TAB FORWARD SMS by E-MAIL

		s.tab('email', _('SMS Forwarding to E-mail Settings'));
		s.anonymous = true;

        var emailProviders = {
	        'custom': {
		        name: _('user define'),
		        smtp: '',
		        port: '',
		        security: 'tls'
	        },
	        'gmail': {
		        name: 'Gmail',
		        smtp: 'smtp.gmail.com',
		        port: '587',
		        security: 'tls'
	        },
	        'outlook': {
		        name: 'Outlook.com / Hotmail',
		        smtp: 'smtp-mail.outlook.com',
		        port: '587',
		        security: 'tls'
	        },
	        'yahoo': {
		        name: 'Yahoo Mail',
		        smtp: 'smtp.mail.yahoo.com',
		        port: '587',
		        security: 'tls'
	        },
	        'icloud': {
		        name: 'iCloud Mail',
		        smtp: 'smtp.mail.me.com',
		        port: '587',
		        security: 'tls'
	        },
	        'aol': {
		        name: 'AOL Mail',
		        smtp: 'smtp.aol.com',
		        port: '587',
		        security: 'tls'
	        },
	        'zoho': {
		        name: 'Zoho Mail',
		        smtp: 'smtp.zoho.com',
		        port: '587',
		        security: 'tls'
	        },
	        'mailru': {
		        name: 'Mail.ru',
		        smtp: 'smtp.mail.ru',
		        port: '465',
		        security: 'ssl'
	        },
	        'yandex': {
		        name: 'Yandex.Mail',
		        smtp: 'smtp.yandex.com',
		        port: '465',
		        security: 'ssl'
	        },
	        'gmx': {
		        name: 'GMX Mail',
		        smtp: 'smtp.gmx.com',
		        port: '587',
		        security: 'tls'
	        },
	        'mailcom': {
		        name: 'Mail.com',
		        smtp: 'smtp.mail.com',
		        port: '587',
		        security: 'tls'
	        },
	        'fastmail': {
		        name: 'FastMail',
		        smtp: 'smtp.fastmail.com',
		        port: '587',
		        security: 'tls'
	        },
	        'sina': {
		        name: 'Sina Mail',
		        smtp: 'smtp.sina.com',
		        port: '587',
		        security: 'tls'
	        },
	        'mailboxorg': {
		        name: 'Mailbox.org',
		        smtp: 'smtp.mailbox.org',
		        port: '587',
		        security: 'tls'
	        },
	        'o2pl': {
		        name: 'o2.pl',
		        smtp: 'poczta.o2.pl',
		        port: '465',
		        security: 'ssl'
	        },
	        'wppl': {
		        name: 'wp.pl',
		        smtp: 'smtp.wp.pl',
		        port: '465',
		        security: 'ssl'
	        },
	        'interia': {
		        name: 'interia.pl',
		        smtp: 'poczta.interia.pl',
		        port: '465',
		        security: 'ssl'
	        }
        };

        o = s.taboption('email', form.Flag, 'forward_sms_enabled',
	        _('Enable message forwarding'));
        o.rmempty = false;
        o.modalonly = true;

        o.write = function(section_id, value) {
	        if (value === '1') {
		        return pkg._isPackageInstalled('mailsend').then(function(isInstalled) {
			        if (!isInstalled) {
				        ui.addNotification(null, E('p', {}, _('Package mailsend is not installed. Please install it first using the Install... button below')), 'info');
				        return form.Flag.prototype.write.apply(this, [section_id, '0']);
			        } else {
				        return form.Flag.prototype.write.apply(this, [section_id, value]);
			        }
		        }.bind(this));
	        }
	        return form.Flag.prototype.write.apply(this, [section_id, value]);
        };
		
		o = s.taboption('email', form.ListValue, 'emailprovider', _('E-mail settings'),
			_('Select a predefined e-mail settings or enter settings manually.'));
		
		for (var key in emailProviders) {
			o.value(key, emailProviders[key].name);
		}
		o.default = 'custom';
		o.modalonly = true;
		
		o.onchange = function(ev, section_id, value) {
			var provider = emailProviders[value] || emailProviders['custom'];
			var map = this.map;
			
			// SMTP server
			var smtpField = map.lookupOption('forward_sms_mail_smtp', section_id);
			if (smtpField && smtpField[0]) {
				smtpField[0].getUIElement(section_id).setValue(provider.smtp);
			}
			
			// Update port
			var portField = map.lookupOption('forward_sms_mail_smtp_port', section_id);
			if (portField && portField[0]) {
				portField[0].getUIElement(section_id).setValue(provider.port);
			}
			
			// Update security
			var securityField = map.lookupOption('forward_sms_mail_security', section_id);
			if (securityField && securityField[0]) {
				securityField[0].getUIElement(section_id).setValue(provider.security);
			}
		};
	
		o = s.taboption('email', form.Value,
			'forward_sms_mail_recipient', _('Recipient'));
		o.description = _('E-mail address of the recipient.');
		o.modalonly   = true;

		o = s.taboption('email', form.Value,
			'forward_sms_mail_sender', _('Sender'));
		o.description = _('E-mail address of the sender.');
		o.modalonly   = true;

		o = s.taboption('email', form.Value,
		'forward_sms_mail_user', _('User'));
		o.description = _('Username for SMTP authentication.');
		o.modalonly   = true;

		o = s.taboption('email', form.Value,
			'forward_sms_mail_password', _('Password'));
		o.description = _('Google app password / Password for SMTP authentication.');
		o.password    = true;
		o.modalonly   = true;

		o = s.taboption('email', form.Value,
			'forward_sms_mail_smtp', _('SMTP server'));
		o.description = _('Hostname/IP address of the SMTP server.');
		o.datatype    = 'host';
		o.modalonly   = true;

		o = s.taboption('email', form.Value,
			'forward_sms_mail_smtp_port', _('SMTP server port'));
		o.datatype  = 'port';
		o.modalonly = true;

		o = s.taboption('email', form.ListValue,
			'forward_sms_mail_security', _('Security'));
		o.description = '%s<br />%s'.format(
			_('TLS: use STARTTLS if the server supports it.'),
			_('SSL: SMTP over SSL.'),
		);
		o.value('tls', 'TLS');
		o.value('ssl', 'SSL');
		o.default   = 'tls';
		o.modalonly = true;

		o = s.taboption('email', form.DummyValue, '_dummy_mailsend');
		o.rawhtml = true;
		o.render = function() {
			return E('div', {}, [
				E('h3', {}, _('Required Package')),
				E('div', { 'class': 'cbi-map-descr' }, _('The SMS forwarding option requires the mailsend package to be installed.'))
			]);
		};

        o = s.taboption('email', form.DummyValue, '_mailsend_status', _('mailsend package'));
        o.rawhtml = true;
        o.cfgvalue = function(section_id) {
	        return '';
        };
        o.render = function(option_index, section_id, in_table) {
	        return pkg._isPackageInstalled('mailsend').then(function(isInstalled) {
		        var content;
		        
		        if (isInstalled) {
			        content = E('span', {
				        'class': 'cbi-value-field',
				        'style': 'font-style: italic;'
			        }, _('Installed'));
		        } else {
			        content = E('button', {
				        'class': 'cbi-button cbi-button-action',
				        'click': function() {
					        pkg.openInstallerSearch('mailsend');
				        }
			        }, _('Install…'));
		        }
		        
		        return E('div', { 'class': 'cbi-value' }, [
			        E('label', { 'class': 'cbi-value-title' }, _('mailsend')),
			        E('div', { 'class': 'cbi-value-field' }, content)
		        ]);
	        });
        };
		
		//TAB USSD

		s.tab('ussd', _('USSD Codes Settings'));
		s.anonymous = true;

		o = s.taboption('ussd', form.ListValue, 'ussdport', _('USSD sending modem'), 
			_('Select one of the available modems from ModemManager.'));
		
		modems.sort(function(a, b) {
			return a.index > b.index ? 1 : -1;
		});
		
		modems.forEach(function(modem) {
			o.value(modem.path, modem.displayName);
		});

		o.placeholder = _('Please select a modem');
		o.rmempty = false;

		o = s.taboption('ussd', form.TextValue, '_tmp4', _('User USSD codes'),
			_("Each line must have the following format: 'Code description;code'. For user convenience, the file is saved to the location <code>/etc/modem/sms_manager_ussdcodes.user</code>."));
		o.rows = 7;
		o.cfgvalue = function(section_id) {
			return fs.trimmed('/etc/modem/sms_manager_ussdcodes.user');
		};
		o.write = function(section_id, formvalue) {
			return fs.write('/etc/modem/sms_manager_ussdcodes.user', formvalue.trim().replace(/\r\n/g, '\n') + '\n');
		};

		//TAB AT

		s.tab('attab', _('AT Commands Settings'));
		s.anonymous = true;

		o = s.taboption('attab' , form.ListValue, 'atport', _('AT commands sending modem'), 
			_('Select one of the available modems from ModemManager. \
			<br /><br /><b>Important</b> \
			<br />Sending AT commands via ModemManager requires the AT command interface to be compiled in. \
			This functionality is not available in the standard ModemManager package and requires custom compilation with AT command support enabled.'));
		
		modems.sort(function(a, b) {
			return a.index > b.index ? 1 : -1;
		});
		
		modems.forEach(function(modem) {
			o.value(modem.path, modem.displayName);
		});

		o.placeholder = _('Please select a modem');
		o.rmempty = false;

		o = s.taboption('attab' , form.TextValue, '_tmp6', _('User AT commands'),
			_("Each line must have the following format: 'At command description;AT command'. For user convenience, the file is saved to the location <code>/etc/modem/sms_manager_atcmmds.user</code>."));
		o.rows = 20;
		o.cfgvalue = function(section_id) {
			return fs.trimmed('/etc/modem/sms_manager_atcmmds.user');
		};
		o.write = function(section_id, formvalue) {
			return fs.write('/etc/modem/sms_manager_atcmmds.user', formvalue.trim().replace(/\r\n/g, '\n') + '\n');
		};

		//TAB INFO

		s.tab('notifytab', _('Notification Settings'));
		s.anonymous = true;

        o = s.taboption('notifytab', form.Flag, 'lednotify', _('Notify new messages'),
	        _('The LED informs about a new message. Before activating this function, please config and save the SMS reading modem, time to check SMS inbox and select the notification LED.')
        );
        o.rmempty = false;
        o.default = true;
        o.write = function(section_id, value) {
	        uci.load('sms_manager').then(function() {
		        let portR = (uci.get('sms_manager', '@sms_manager[0]', 'readport'));
		        let dsled = (uci.get('sms_manager', '@sms_manager[0]', 'ledtype'));
		        let led = (uci.get('sms_manager', '@sms_manager[0]', 'smsled'));
		        if (!portR) {
			        ui.addNotification(null, E('p', {}, _('Please configure SMS reading modem first')), 'info');
			        return form.Flag.prototype.write.apply(this, [section_id, value]);
		        }
		        let modemNum = portR.split('/').pop();
		        L.resolveDefault(fs.exec_direct('/usr/bin/mmcli', ['-m', modemNum, '--messaging-list-sms']), null)
			        .then(function(res) {
				        if (res) {
					        let smsCount = 0;
					        let matches = res.matchAll(/\/SMS\/(\d+)/g);
					        for (let match of matches) {
						        smsCount++;
					        }
					        if (value == '1') {
						        uci.set('sms_manager', '@sms_manager[0]', 'sms_count', String(smsCount));
						        uci.set('sms_manager', '@sms_manager[0]', 'lednotify', "1");
						        uci.save();
						        
						        let PTR = uci.get('sms_manager', '@sms_manager[0]', 'prestart');
						        
						        L.resolveDefault(fs.read('/etc/crontabs/root'), '').then(function(crontab) {
							        let cronEntry = '1 */' + PTR + ' * * *  /etc/init.d/sms_manager enable && /etc/init.d/sms_manager restart';
                                        
                                    let lines = (crontab || '').trim().split('\n').filter(function(line) {
                                        return line.trim() !== '' && !line.includes('/etc/init.d/sms_manager');
                                    });
                                        
                                        lines.push(cronEntry);
                                        
                                    let newCrontab = lines.join('\n') + '\n';
                                        
                                    fs.write('/etc/crontabs/root', newCrontab).then(function() {
                                        fs.exec_direct('/etc/init.d/cron', ['restart']);
                                    });
                                });
						        
						        fs.exec_direct('/etc/init.d/sms_manager', [ 'enable' ]);
						        fs.exec('sleep 2');
						        fs.exec_direct('/etc/init.d/sms_manager', [ 'start' ]);
					        }
					        if (value == '0') {
						        uci.set('sms_manager', '@sms_manager[0]', 'lednotify', "0");
						        uci.save();
						        
						        L.resolveDefault(fs.read('/etc/crontabs/root'), '').then(function(crontab) {
							        let lines = (crontab || '').trim().replace(/\r\n/g, '\n').split('\n');
							        let filteredLines = lines.filter(function(line) {
								        return line.trim() !== '' && !line.includes('sms_manager');
							        });
							        let newCrontab = filteredLines.join('\n') + '\n';
							        
							        fs.write('/etc/crontabs/root', newCrontab).then(function() {
								        fs.exec_direct('/etc/init.d/cron', ['restart']);
							        });
						        });
						        
						        fs.exec_direct('/etc/init.d/sms_manager', [ 'stop' ]);
						        fs.exec('sleep 2');
						        fs.exec_direct('/etc/init.d/sms_manager', [ 'disable' ]);
						        if (dsled == 'D' && led) {
							        fs.write('/sys/class/leds/'+led+'/brightness', '0');
						        }
					        }
				        }
		        });
	        });
	        
	        return form.Flag.prototype.write.apply(this, [section_id, value]);
        };

		o = s.taboption('notifytab', form.Value, 'checktime', _('Check inbox every minute(s)'),
			_('Specify how many minutes you want your inbox to be checked.'));
		o.default = '10';
		o.rmempty = false;
		o.validate = function(section_id, value) {

			if (value.match(/^[0-9]+(?:\.[0-9]+)?$/) && +value >= 5 && +value < 60)
				return true;

			return _('Expect a decimal value between five and fifty-nine');
		};
		o.datatype = 'range(5, 59)';

		o = s.taboption('notifytab' , form.ListValue, 'prestart', _('Restart the inbox checking process every'),
			_('The process will restart at the selected time interval. This will eliminate the delay in checking your inbox.'));
		o.value('4', _('4h'));
		o.value('6', _('6h'));
		o.value('8', _('8h'));
		o.value('12', _('12h'));
		o.default = '6';
		o.rmempty = false;

		o = s.taboption('notifytab' , form.ListValue, 'ledtype',
			_('The diode is dedicated only to these notifications'),
			_("Select 'No' in case the router has only one LED or if the LED is multi-tasking. \
				<br /><br /><b>Important</b> \
				<br />This option requires LED to be defined in the system (if possible) to work properly. \
				This requirement applies when the diode supports multiple tasks."));
		o.value('S', _('No'));
		o.value('D', _('Yes'));
		o.default = 'D';
		o.rmempty = false;

		o = s.taboption('notifytab', form.ListValue, 'smsled',_('<abbr title="Light Emitting Diode">LED</abbr> Name'),
			_('Select the notification LED.'));
		o.load = function(section_id) {
			return L.resolveDefault(fs.list('/sys/class/leds'), []).then(L.bind(function(leds) {
				if(leds.length > 0) {
					leds.sort((a, b) => a.name > b.name);
					leds.forEach(e => o.value(e.name));
				}
				return this.super('load', [section_id]);
			}, this));
		};
		o.exclude = s.section;
		o.nocreate = true;
		o.optional = true;
		o.rmempty = true;

		return m.render();
	}
});
