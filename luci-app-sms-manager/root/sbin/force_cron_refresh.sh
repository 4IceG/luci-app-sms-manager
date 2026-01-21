#!/bin/sh

sleep 2

[ -e /etc/crontabs/root ] || touch /etc/crontabs/root

	if grep -q "sms_manager" /etc/crontabs/root; then
		grep -v "sms_manager" /etc/crontabs/root > /tmp/new_cron
		mv /tmp/new_cron /etc/crontabs/root
		/etc/init.d/cron restart
	fi
	
exit 0

