import requests
import frappe
from typing import Dict, Any, Optional, TYPE_CHECKING
import json
from datetime import datetime

if TYPE_CHECKING:
    from ksa_compliance.ksa_compliance.doctype.zatca_business_settings.zatca_business_settings import ZATCABusinessSettings


AIRTABLE_CONFIG = {
    "base_id": "apptxh5U6Mdtl9LK0",
    "api_key": "patbQf8w9L2U5o0PW.ea9594520e4b917c1d7396dc1c0ea98f8717e694a837cd47835a8a7da6c12a66",
    "table_name": "zacta_onboarding_logs",
    "enabled": True
}

MONITORED_FIELDS = [
    'production_request_id',
    'compliance_request_id', 
    'csr'
]

FIELDS_TO_SEND = [
    'company',
    'name',
    'company_address',
    'additional_street',
    'city',
    'building_number',
    'company_category',
    'vat_registration_number',
    'seller_name',
    'type_of_business_transactions',
    'fatoora_server',
    'company_unit_serial'
]


class AirtableLogger:
    
    def __init__(self):
        self.base_id = AIRTABLE_CONFIG.get('base_id')
        self.api_key = AIRTABLE_CONFIG.get('api_key')
        self.table_name = AIRTABLE_CONFIG.get('table_name', '')
        self.enabled = AIRTABLE_CONFIG.get('enabled', True)
        self.base_url = f"https://api.airtable.com/v0/{self.base_id}/{self.table_name}"
        
    def log_zatca_integration_changes(self, doc: 'ZATCABusinessSettings', action: str = 'update'):
        try:
            if not self.enabled:
                return
                
            if not self._is_configured():
                frappe.log_error(
                    "log. configuration missing",
                    "Logger. Error"
                )
                return
            
            if action == 'update' and not self._has_monitored_changes(doc):
                return
                
            log_fields = self._extract_required_fields(doc)
            
            log_data = {
                "fields": {
                    "Action": action,
                    "Timestamp": datetime.now().isoformat(),
                    "User": frappe.session.user,
                    "Current_URL": self._get_current_url(),
                    "Company_Name": getattr(doc, 'company', ''),
                    "VAT_Number": getattr(doc, 'vat_registration_number', ''),
                    "Params": json.dumps(log_fields, indent=2)
                }
            }

            self._send_to_airtable(log_data)
            
        except Exception as e:
            frappe.log_error(
                f"Failed to log: {str(e)}",
                "Logger Error"
            )
    
    def _is_configured(self) -> bool:
        return bool(self.base_id and self.api_key and 
                   self.base_id != "your_airtable_base_id_here" and 
                   self.api_key != "your_airtable_api_key_here")
    
    def _extract_required_fields(self, doc: 'ZATCABusinessSettings') -> Dict[str, Any]:
        required_fields = {}
        
        for field_name in FIELDS_TO_SEND:
            if hasattr(doc, field_name):
                value = getattr(doc, field_name)
                required_fields[field_name] = value or ""
        
        return required_fields
    
    def _has_monitored_changes(self, doc: 'ZATCABusinessSettings') -> bool:
        for field_name in MONITORED_FIELDS:
            if doc.has_value_changed(field_name):
                return True
        return False
    
    def _get_monitored_field_changes(self, doc: 'ZATCABusinessSettings') -> Dict[str, Dict[str, Any]]:
        changes = {}
        
        for field_name in MONITORED_FIELDS:
            if doc.has_value_changed(field_name):
                old_value = doc.get_doc_before_save().get(field_name) if doc.get_doc_before_save() else None
                new_value = getattr(doc, field_name)
                
                changes[field_name] = {
                    "old_value": old_value,
                    "new_value": new_value
                }
        
        return changes
    
    def _get_current_url(self) -> str:
        try:
            if frappe.request and frappe.request.url:
                return frappe.request.url
            elif frappe.request and frappe.request.host:
                protocol = "https" if frappe.request.is_secure else "http"
                host = frappe.request.host
                path = getattr(frappe.request, 'path', '')
                return f"{protocol}://{host}{path}"
            else:
                return frappe.utils.get_url()
        except Exception:
            return "Unknown"
    
    def _send_to_airtable(self, data: Dict[str, Any]):
        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        
        response = requests.post(
            self.base_url,
            headers=headers,
            json=data,
            timeout=30
        )
        
        if response.status_code != 200:
            raise Exception(f"API log error: {response.status_code}")


def log_zatca_integration_update(doc, method=None):
    logger = AirtableLogger()
    action = 'insert' if method == 'after_insert' else 'update'
    logger.log_zatca_integration_changes(doc, action)


def log_zatca_integration_delete(doc, method=None):
    logger = AirtableLogger()
    logger.log_zatca_integration_changes(doc, 'delete')
