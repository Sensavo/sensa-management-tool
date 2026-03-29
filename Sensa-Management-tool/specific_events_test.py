#!/usr/bin/env python3
"""
Specific test for the 8 events as requested in the review.
Tests GET /api/events endpoint and validates the specific events and their structure.
"""

import requests
import json
from datetime import datetime

class SpecificEventsTest:
    def __init__(self):
        self.base_url = "https://task-hub-890.preview.emergentagent.com"
        self.api_url = f"{self.base_url}/api"
        self.expected_events = [
            {"title": "BODYART LIGHT", "date": "2025-02-12"},
            {"title": "ЧАЮВАННЯ |НЕ| САМОТНІХ", "date": "2025-02-13"},
            {"title": "MINDFUL MOVIE — ПРОЕКЦІЯ", "date": "2025-02-15"},
            {"title": "УСВІДОМЛЕНІ ІГРИ", "date": "2025-02-17"},
            {"title": "ПРАКТИКУМ «ВИХІД З КОНФЛІКТІВ»", "date": "2025-02-21"},
            {"title": "КАДЛ", "date": "2025-02-22"},
            {"title": "АКРОЙОГА (СТАРТ ГРУПИ)", "date": "2025-02-24"},
            {"title": "ЧАЙНА ТУСА", "date": "2025-02-27"}
        ]
        self.test_results = []
        
    def log_result(self, test_name, success, details=""):
        """Log test result"""
        status = "✅" if success else "❌"
        print(f"{status} {test_name}")
        if details:
            print(f"   {details}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details
        })
        return success
    
    def test_api_connectivity(self):
        """Test basic API connectivity"""
        try:
            response = requests.get(f"{self.api_url}/", timeout=10)
            success = response.status_code == 200
            return self.log_result(
                "API Connectivity", 
                success, 
                f"Status: {response.status_code}"
            )
        except Exception as e:
            return self.log_result("API Connectivity", False, f"Error: {str(e)}")
    
    def test_get_events_endpoint(self):
        """Test GET /api/events endpoint"""
        try:
            response = requests.get(f"{self.api_url}/events", timeout=10)
            success = response.status_code == 200
            
            if success:
                try:
                    events = response.json()
                    success = isinstance(events, list)
                    details = f"Status: {response.status_code}, Events count: {len(events)}"
                except json.JSONDecodeError:
                    success = False
                    details = "Invalid JSON response"
                    events = []
            else:
                details = f"Status: {response.status_code}"
                events = []
            
            result = self.log_result("GET /api/events", success, details)
            return events if result else []
            
        except Exception as e:
            self.log_result("GET /api/events", False, f"Error: {str(e)}")
            return []
    
    def test_events_count(self, events):
        """Test that exactly 8 events are returned"""
        expected_count = 8
        actual_count = len(events)
        success = actual_count == expected_count
        
        return self.log_result(
            "Events Count", 
            success, 
            f"Expected: {expected_count}, Got: {actual_count}"
        )
    
    def test_specific_events_present(self, events):
        """Test that all expected events are present"""
        found_events = []
        missing_events = []
        
        for expected in self.expected_events:
            found = False
            for event in events:
                if (event.get("title") == expected["title"] and 
                    event.get("date") == expected["date"]):
                    found_events.append(expected)
                    found = True
                    break
            
            if not found:
                missing_events.append(expected)
        
        success = len(missing_events) == 0
        details = f"Found: {len(found_events)}/8"
        if missing_events:
            details += f", Missing: {[e['title'] for e in missing_events]}"
        
        return self.log_result("Expected Events Present", success, details)
    
    def test_event_structure(self, events):
        """Test that each event has the required fields with correct types"""
        required_fields = {
            "id": str,
            "title": str,
            "date": str,
            "price": (int, float),
            "description": str,
            "spots": int,
            "start_time": str,
            "cancelled": bool
        }
        
        structure_errors = []
        
        for i, event in enumerate(events):
            for field, expected_type in required_fields.items():
                if field not in event:
                    structure_errors.append(f"Event {i+1}: Missing field '{field}'")
                elif not isinstance(event[field], expected_type):
                    structure_errors.append(
                        f"Event {i+1}: Field '{field}' has type {type(event[field]).__name__}, "
                        f"expected {expected_type.__name__ if not isinstance(expected_type, tuple) else '/'.join(t.__name__ for t in expected_type)}"
                    )
        
        success = len(structure_errors) == 0
        details = f"Checked {len(events)} events"
        if structure_errors:
            details += f", Errors: {len(structure_errors)}"
            # Show first few errors
            for error in structure_errors[:3]:
                print(f"   - {error}")
            if len(structure_errors) > 3:
                print(f"   - ... and {len(structure_errors) - 3} more errors")
        
        return self.log_result("Event Structure", success, details)
    
    def test_date_format(self, events):
        """Test that all dates are in YYYY-MM-DD format"""
        date_errors = []
        
        for i, event in enumerate(events):
            date_str = event.get("date", "")
            try:
                # Try to parse as YYYY-MM-DD
                datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                date_errors.append(f"Event {i+1} ({event.get('title', 'Unknown')}): Invalid date format '{date_str}'")
        
        success = len(date_errors) == 0
        details = f"Checked {len(events)} events"
        if date_errors:
            details += f", Invalid dates: {len(date_errors)}"
            for error in date_errors[:3]:
                print(f"   - {error}")
        
        return self.log_result("Date Format", success, details)
    
    def test_spots_value(self, events):
        """Test that all events have spots = 10"""
        spots_errors = []
        
        for i, event in enumerate(events):
            spots = event.get("spots")
            if spots != 10:
                spots_errors.append(f"Event {i+1} ({event.get('title', 'Unknown')}): spots = {spots}, expected 10")
        
        success = len(spots_errors) == 0
        details = f"Checked {len(events)} events"
        if spots_errors:
            details += f", Wrong spots: {len(spots_errors)}"
            for error in spots_errors[:3]:
                print(f"   - {error}")
        
        return self.log_result("Spots Value (should be 10)", success, details)
    
    def test_cancelled_value(self, events):
        """Test that all events have cancelled = false"""
        cancelled_errors = []
        
        for i, event in enumerate(events):
            cancelled = event.get("cancelled")
            if cancelled is not False:
                cancelled_errors.append(f"Event {i+1} ({event.get('title', 'Unknown')}): cancelled = {cancelled}, expected false")
        
        success = len(cancelled_errors) == 0
        details = f"Checked {len(events)} events"
        if cancelled_errors:
            details += f", Wrong cancelled status: {len(cancelled_errors)}"
            for error in cancelled_errors[:3]:
                print(f"   - {error}")
        
        return self.log_result("Cancelled Value (should be false)", success, details)
    
    def test_uuid_format(self, events):
        """Test that all event IDs are valid UUIDs"""
        import re
        uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
        
        uuid_errors = []
        
        for i, event in enumerate(events):
            event_id = event.get("id", "")
            if not uuid_pattern.match(event_id):
                uuid_errors.append(f"Event {i+1} ({event.get('title', 'Unknown')}): Invalid UUID format '{event_id}'")
        
        success = len(uuid_errors) == 0
        details = f"Checked {len(events)} events"
        if uuid_errors:
            details += f", Invalid UUIDs: {len(uuid_errors)}"
            for error in uuid_errors[:3]:
                print(f"   - {error}")
        
        return self.log_result("UUID Format", success, details)
    
    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Testing Specific Events Requirements")
        print("=" * 60)
        
        # Test API connectivity first
        if not self.test_api_connectivity():
            print("❌ Cannot connect to API, stopping tests")
            return False
        
        # Get events
        events = self.test_get_events_endpoint()
        if not events:
            print("❌ Cannot get events, stopping tests")
            return False
        
        # Run all validation tests
        tests_passed = 0
        total_tests = 7  # Number of validation tests
        
        if self.test_events_count(events):
            tests_passed += 1
        
        if self.test_specific_events_present(events):
            tests_passed += 1
        
        if self.test_event_structure(events):
            tests_passed += 1
        
        if self.test_date_format(events):
            tests_passed += 1
        
        if self.test_spots_value(events):
            tests_passed += 1
        
        if self.test_cancelled_value(events):
            tests_passed += 1
        
        if self.test_uuid_format(events):
            tests_passed += 1
        
        print("=" * 60)
        print(f"📊 Tests completed: {tests_passed + 1}/{total_tests + 1} passed")  # +1 for connectivity test
        
        # Show sample event for verification
        if events:
            print(f"\n📋 Sample Event Structure:")
            sample = events[0]
            for key, value in sample.items():
                print(f"   {key}: {value} ({type(value).__name__})")
        
        return tests_passed == total_tests

def main():
    tester = SpecificEventsTest()
    success = tester.run_all_tests()
    
    print(f"\n🎯 Overall Result: {'✅ PASS' if success else '❌ FAIL'}")
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())