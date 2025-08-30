#!/usr/bin/env python3
"""
Run this script to test the Airtable logging functionality
"""

import frappe
from ksa_compliance.airtable_logger import AirtableLogger


def test_airtable_configuration():
    """Test if Airtable is properly configured"""
    print("Testing Airtable configuration...")
    
    logger = AirtableLogger()
    
    if not logger._is_configured():
        print("❌ Airtable is not configured properly")
        print("Please add the following to your site_config.json:")
        print("  - airtable_base_id")
        print("  - airtable_api_key")
        print("  - airtable_table_name (optional, defaults to 'ZATCA_Settings_Log')")
        return False
    
    print("✅ Airtable configuration found")
    print(f"Base ID: {logger.base_id}")
    print(f"Table Name: {logger.table_name}")
    print(f"API URL: {logger.base_url}")
    return True


def test_zatca_business_settings_hook():
    """Test the hook functionality with a sample document"""
    print("\nTesting ZATCA Business Settings hook...")
    
    try:
        # Find an existing ZATCA Business Settings document
        settings_list = frappe.get_all('ZATCA Business Settings', limit=1)
        
        if not settings_list:
            print("❌ No ZATCA Business Settings documents found")
            print("Please create at least one ZATCA Business Settings document to test")
            return False
        
        doc_name = settings_list[0].name
        doc = frappe.get_doc('ZATCA Business Settings', doc_name)
        
        print(f"✅ Found ZATCA Business Settings document: {doc_name}")
        
        # Test the logger directly
        logger = AirtableLogger()
        logger.log_zatca_integration_changes(doc, 'test')
        
        print("✅ Successfully tested Airtable logging")
        return True
        
    except Exception as e:
        print(f"❌ Error testing hook: {str(e)}")
        return False


def main():
    """Main test function"""
    print("🔍 ZATCA Business Settings Airtable Integration Test")
    print("=" * 50)
    
    # Initialize Frappe
    frappe.init(site='your_site_name')  # Replace with your actual site name
    frappe.connect()
    
    try:
        # Test configuration
        config_ok = test_airtable_configuration()
        
        if config_ok:
            # Test hook functionality
            hook_ok = test_zatca_business_settings_hook()
            
            if hook_ok:
                print("\n🎉 All tests passed! Airtable integration is working correctly.")
            else:
                print("\n⚠️ Configuration OK but hook test failed.")
        else:
            print("\n⚠️ Please fix configuration and try again.")
            
    except Exception as e:
        print(f"\n❌ Test failed with error: {str(e)}")
    
    finally:
        frappe.destroy()


if __name__ == "__main__":
    main()
