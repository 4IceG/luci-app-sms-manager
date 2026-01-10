#!/bin/sh
#
# Copyright 2026 Rafał Wabik (IceG) - From eko.one.pl forum
# Licensed to the GNU General Public License v3.0.
#

	DEV=$(uci -q get sms_manager.@sms_manager[0].readport)
	LEDX=$(uci -q get sms_manager.@sms_manager[0].smsled)
	SMSC=$(uci -q get sms_manager.@sms_manager[0].sms_count)
	SMSD=$(echo $SMSC | tr -dc '0-9')
	LEDT="/sys/class/leds/$LEDX/trigger"
	LEDON="/sys/class/leds/$LEDX/delay_on"
	LEDOFF="/sys/class/leds/$LEDX/delay_off"

	TMON=$((1 * 1000))
	TMOFF=$((5 * 1000))

if [ -z "$DEV" ]; then
	exit 0
fi

MODEM_NUM=$(echo $DEV | awk -F'/' '{print $NF}')

SMS_LIST=$(mmcli -m $MODEM_NUM --messaging-list-sms  >/dev/null 2>&1)

if [ -z "$SMS_LIST" ]; then
	exit 0
fi

SMS=$(echo "$SMS_LIST" | grep -c "/SMS/")

if [ $SMS == $SMSD ]; then

	exit 0
fi

if [ $SMS -gt $SMSD ]; then

echo timer > $LEDT
echo $TMOFF > $LEDOFF
echo $TMON > $LEDON
exit 0

fi


exit 0
