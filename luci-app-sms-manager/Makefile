#
# Copyright 2026 Rafał Wabik - IceG - From eko.one.pl forum
#
# Licensed to the GNU General Public License v3.0.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-sms-manager
LUCI_TITLE:=SMS Support in LuCI JS via ModemManager
PKG_MAINTAINER:=Rafał Wabik <4Rafal@gmail.com>
LUCI_DESCRIPTION:=LuCI JS interface for the SMS via ModemManager. The user interface supports SMS / USSD Codes / AT Commands.
LUCI_PKGARCH:=all
LUCI_DEPENDS:=+modemmanager +luci-proto-modemmanager
PKG_VERSION:=1.0.6
PKG_RELEASE:=20260121

define Package/luci-app-sms-manager/conffiles
/etc/config/sms_manager
/etc/modem/sms_manager_atcmmds.user
/etc/modem/sms_manager_phonebook.user
/etc/modem/sms_manager_ussdcodes.user
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
