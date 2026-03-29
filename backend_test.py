import requests
import sys
import json
from datetime import datetime, timedelta

class EventFlowAPITester:
    def __init__(self, base_url="https://task-hub-890.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def test_api_root(self):
        """Test API root endpoint"""
        try:
            response = requests.get(f"{self.api_url}/")
            success = response.status_code == 200 and "sensa API" in response.json().get("message", "")
            self.log_test("API Root", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("API Root", False, str(e))
            return False

    def test_get_settings(self):
        """Test get settings endpoint"""
        try:
            response = requests.get(f"{self.api_url}/settings")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "reminder_types" in data and isinstance(data["reminder_types"], list)
                if success and len(data["reminder_types"]) >= 2:
                    # Check default reminders exist (Ukrainian names)
                    reminder_names = [rt["name"] for rt in data["reminder_types"]]
                    success = "анонс події" in reminder_names and "запуск реклами" in reminder_names
            self.log_test("Get Settings", success, f"Status: {response.status_code}")
            return response.json() if success else None
        except Exception as e:
            self.log_test("Get Settings", False, str(e))
            return None

    def test_add_reminder(self):
        """Test add reminder endpoint"""
        try:
            test_data = {
                "name": "Тестове нагадування",
                "days_before": 3,
                "icon": "bell"
            }
            response = requests.post(f"{self.api_url}/settings/reminders", json=test_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "reminder_types" in data
                # Check if our reminder was added
                if success:
                    reminder_names = [rt["name"] for rt in data["reminder_types"]]
                    success = "Тестове нагадування" in reminder_names
            self.log_test("Add Reminder", success, f"Status: {response.status_code}")
            return response.json() if success else None
        except Exception as e:
            self.log_test("Add Reminder", False, str(e))
            return None

    def test_create_event(self):
        """Test create event endpoint"""
        try:
            # Create event for future date (2026)
            future_date = "2026-03-15"
            test_data = {
                "title": "Test Event",
                "date": future_date,
                "price": 100.0,
                "description": "Test event description"
            }
            response = requests.post(f"{self.api_url}/events", json=test_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = (data.get("title") == "Test Event" and 
                          data.get("price") == 100.0 and
                          "id" in data and
                          "reminders" in data and
                          "completed_tasks" in data)
            self.log_test("Create Event", success, f"Status: {response.status_code}")
            return response.json() if success else None
        except Exception as e:
            self.log_test("Create Event", False, str(e))
            return None

    def test_get_events(self):
        """Test get all events endpoint"""
        try:
            response = requests.get(f"{self.api_url}/events")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list)
            self.log_test("Get Events", success, f"Status: {response.status_code}, Count: {len(data) if success else 0}")
            return data if success else []
        except Exception as e:
            self.log_test("Get Events", False, str(e))
            return []

    def test_get_event_by_id(self, event_id):
        """Test get single event endpoint"""
        try:
            response = requests.get(f"{self.api_url}/events/{event_id}")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = data.get("id") == event_id
            self.log_test("Get Event by ID", success, f"Status: {response.status_code}")
            return response.json() if success else None
        except Exception as e:
            self.log_test("Get Event by ID", False, str(e))
            return None

    def test_update_event(self, event_id):
        """Test update event endpoint"""
        try:
            update_data = {
                "title": "Updated Test Event",
                "price": 150.0
            }
            response = requests.put(f"{self.api_url}/events/{event_id}", json=update_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = data.get("title") == "Updated Test Event" and data.get("price") == 150.0
            self.log_test("Update Event", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Update Event", False, str(e))
            return False

    def test_complete_task(self, event_id):
        """Test task completion endpoint"""
        try:
            # Get settings to find a reminder ID
            settings_response = requests.get(f"{self.api_url}/settings")
            if settings_response.status_code != 200:
                self.log_test("Complete Task", False, "Could not get settings for reminder ID")
                return False
                
            settings = settings_response.json()
            if not settings.get("reminder_types"):
                self.log_test("Complete Task", False, "No reminder types found")
                return False
                
            reminder_id = settings["reminder_types"][0]["id"]
            
            # Mark task as completed
            test_data = {
                "event_id": event_id,
                "reminder_id": reminder_id,
                "completed": True
            }
            response = requests.post(f"{self.api_url}/tasks/complete", json=test_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = data.get("success") == True and "completed_tasks" in data
            self.log_test("Complete Task", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Complete Task", False, str(e))
            return False

    def test_get_task_archive(self):
        """Test task archive endpoint"""
        try:
            response = requests.get(f"{self.api_url}/tasks/archive")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list)
            self.log_test("Get Task Archive", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Get Task Archive", False, str(e))
            return False

    def test_delete_reminder(self, reminder_id):
        """Test delete reminder endpoint"""
        try:
            response = requests.delete(f"{self.api_url}/settings/reminders/{reminder_id}")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "reminder_types" in data
            self.log_test("Delete Reminder", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Delete Reminder", False, str(e))
            return False

    def test_google_calendar_export(self, event_id):
        """Test Google Calendar export endpoint"""
        try:
            response = requests.get(f"{self.api_url}/events/{event_id}/google-calendar-url")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "url" in data and "calendar.google.com" in data["url"]
            self.log_test("Google Calendar Export", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Google Calendar Export", False, str(e))
            return False

    def test_daily_quote(self):
        """Test daily quote endpoint"""
        try:
            response = requests.get(f"{self.api_url}/quote")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "quote" in data and isinstance(data["quote"], str) and len(data["quote"]) > 0
            self.log_test("Daily Quote", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Daily Quote", False, str(e))
            return False

    def test_statistics(self):
        """Test statistics endpoint"""
        try:
            response = requests.get(f"{self.api_url}/statistics")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list)
            self.log_test("Statistics", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Statistics", False, str(e))
            return False

    def test_create_standalone_task(self):
        """Test create standalone task endpoint"""
        try:
            test_data = {
                "title": "Test Standalone Task",
                "date": "2026-03-20"
            }
            response = requests.post(f"{self.api_url}/tasks/standalone", json=test_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = (data.get("title") == "Test Standalone Task" and 
                          data.get("date") == "2026-03-20" and
                          "id" in data and
                          data.get("completed") == False)
            self.log_test("Create Standalone Task", success, f"Status: {response.status_code}")
            return response.json() if success else None
        except Exception as e:
            self.log_test("Create Standalone Task", False, str(e))
            return None

    def test_get_standalone_tasks(self):
        """Test get standalone tasks endpoint"""
        try:
            response = requests.get(f"{self.api_url}/tasks/standalone")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list)
            self.log_test("Get Standalone Tasks", success, f"Status: {response.status_code}")
            return data if success else []
        except Exception as e:
            self.log_test("Get Standalone Tasks", False, str(e))
            return []

    def test_update_standalone_task(self, task_id):
        """Test update standalone task endpoint"""
        try:
            response = requests.put(f"{self.api_url}/tasks/standalone/{task_id}?completed=true")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = data.get("success") == True
            self.log_test("Update Standalone Task", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Update Standalone Task", False, str(e))
            return False

    def test_altegio_export(self, event_id):
        """Test Altegio export endpoint"""
        try:
            response = requests.get(f"{self.api_url}/events/{event_id}/altegio-url")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "message" in data  # Should have message even if not configured
            self.log_test("Altegio Export", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Altegio Export", False, str(e))
            return False

    def test_delete_standalone_task(self, task_id):
        """Test delete standalone task endpoint"""
        try:
            response = requests.delete(f"{self.api_url}/tasks/standalone/{task_id}")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "message" in data
            self.log_test("Delete Standalone Task", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Delete Standalone Task", False, str(e))
            return False

    def test_delete_event(self, event_id):
        """Test delete event endpoint"""
        try:
            response = requests.delete(f"{self.api_url}/events/{event_id}")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "message" in data
            self.log_test("Delete Event", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Delete Event", False, str(e))
            return False

    def test_smm_tasks_definition(self):
        """Test SMM tasks definition endpoint"""
        try:
            response = requests.get(f"{self.api_url}/smm/tasks-definition")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list) and len(data) == 20
                if success:
                    # Check structure of first task
                    first_task = data[0]
                    required_fields = ["id", "name", "days_before", "is_posting"]
                    success = all(field in first_task for field in required_fields)
            self.log_test("SMM Tasks Definition", success, f"Status: {response.status_code}, Count: {len(data) if isinstance(data, list) else 0}")
            return data if success else None
        except Exception as e:
            self.log_test("SMM Tasks Definition", False, str(e))
            return None

    def test_events_have_smm_fields(self):
        """Test that events have SMM task fields"""
        try:
            response = requests.get(f"{self.api_url}/events")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list) and len(data) >= 8
                if success:
                    # Check that all events have smm_tasks and completed_smm_tasks
                    for event in data:
                        if not ("smm_tasks" in event and "completed_smm_tasks" in event):
                            success = False
                            break
                        # Check that smm_tasks is a dictionary with task IDs and dates
                        if not isinstance(event["smm_tasks"], dict) or not isinstance(event["completed_smm_tasks"], dict):
                            success = False
                            break
            self.log_test("Events Have SMM Fields", success, f"Status: {response.status_code}, Events: {len(data) if isinstance(data, list) else 0}")
            return data if success else None
        except Exception as e:
            self.log_test("Events Have SMM Fields", False, str(e))
            return None

    def test_complete_smm_task(self, event_id):
        """Test SMM task completion endpoint"""
        try:
            # Complete the "smm_text_announcement" task
            test_data = {
                "event_id": event_id,
                "task_id": "smm_text_announcement",
                "completed": True
            }
            response = requests.post(f"{self.api_url}/tasks/smm/complete", json=test_data)
            success = response.status_code == 200
            if success:
                data = response.json()
                success = data.get("success") == True and "completed_smm_tasks" in data
                # Check that the task is now marked as completed
                if success:
                    success = "smm_text_announcement" in data["completed_smm_tasks"]
            self.log_test("Complete SMM Task", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Complete SMM Task", False, str(e))
            return False

    def test_statistics_structure(self):
        """Test statistics endpoint returns required fields"""
        try:
            response = requests.get(f"{self.api_url}/statistics")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = isinstance(data, list)
                if success and len(data) > 0:
                    # Check structure of first statistics entry
                    first_stat = data[0]
                    required_fields = ["events_count", "cancelled_count", "planned_revenue", "missed_deadlines_percent", "badges"]
                    success = all(field in first_stat for field in required_fields)
            self.log_test("Statistics Structure", success, f"Status: {response.status_code}, Entries: {len(data) if isinstance(data, list) else 0}")
            return success
        except Exception as e:
            self.log_test("Statistics Structure", False, str(e))
            return False

    def test_settings_reminder_types(self):
        """Test settings endpoint returns reminder_types"""
        try:
            response = requests.get(f"{self.api_url}/settings")
            success = response.status_code == 200
            if success:
                data = response.json()
                success = "reminder_types" in data and isinstance(data["reminder_types"], list)
                if success and len(data["reminder_types"]) > 0:
                    # Check structure of first reminder type
                    first_reminder = data["reminder_types"][0]
                    required_fields = ["id", "name", "days_before", "icon"]
                    success = all(field in first_reminder for field in required_fields)
            self.log_test("Settings Reminder Types", success, f"Status: {response.status_code}")
            return success
        except Exception as e:
            self.log_test("Settings Reminder Types", False, str(e))
            return False

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting EventFlow API Tests...")
        print("=" * 50)
        
        # Test API root
        if not self.test_api_root():
            print("❌ API root failed, stopping tests")
            return False
        
        # Test daily quote
        self.test_daily_quote()
        
        # Test statistics structure
        self.test_statistics_structure()
        
        # Test settings reminder types
        self.test_settings_reminder_types()
        
        # Test SMM tasks definition
        smm_tasks = self.test_smm_tasks_definition()
        if not smm_tasks:
            print("❌ SMM tasks definition failed")
        
        # Test events have SMM fields
        events_with_smm = self.test_events_have_smm_fields()
        if not events_with_smm:
            print("❌ Events SMM fields test failed")
        
        # Test settings
        original_settings = self.test_get_settings()
        if not original_settings:
            print("❌ Settings API failed")
            return False
            
        # Test add reminder
        updated_settings = self.test_add_reminder()
        test_reminder_id = None
        if updated_settings:
            # Find the test reminder ID for cleanup
            for rt in updated_settings["reminder_types"]:
                if rt["name"] == "Тестове нагадування":
                    test_reminder_id = rt["id"]
                    break
        
        # Test standalone tasks
        created_task = self.test_create_standalone_task()
        task_id = None
        if created_task:
            task_id = created_task["id"]
            self.test_get_standalone_tasks()
            self.test_update_standalone_task(task_id)
        
        # Test events CRUD
        created_event = self.test_create_event()
        if not created_event:
            print("❌ Event creation failed, stopping event tests")
            return False
            
        event_id = created_event["id"]
        
        # Test get events
        events = self.test_get_events()
        
        # Test get single event
        self.test_get_event_by_id(event_id)
        
        # Test update event
        self.test_update_event(event_id)
        
        # Test task completion
        self.test_complete_task(event_id)
        
        # Test SMM task completion
        self.test_complete_smm_task(event_id)
        
        # Test task archive
        self.test_get_task_archive()
        
        # Test Google Calendar export
        self.test_google_calendar_export(event_id)
        
        # Test Altegio export
        self.test_altegio_export(event_id)
        
        # Test delete event (cleanup)
        self.test_delete_event(event_id)
        
        # Cleanup standalone task
        if task_id:
            self.test_delete_standalone_task(task_id)
        
        # Cleanup test reminder
        if test_reminder_id:
            self.test_delete_reminder(test_reminder_id)
        
        print("=" * 50)
        print(f"📊 Tests completed: {self.tests_passed}/{self.tests_run} passed")
        
        return self.tests_passed == self.tests_run

def main():
    tester = EventFlowAPITester()
    success = tester.run_all_tests()
    
    # Print detailed results
    print("\n📋 Detailed Results:")
    for result in tester.test_results:
        status = "✅" if result["success"] else "❌"
        print(f"{status} {result['test']}: {result['details']}")
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())