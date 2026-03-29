"""
Backend API tests for Settings page 4-column layout and task definitions
Tests:
- GET /api/smm/tasks-definition returns management, smm, marketing, monthly, daily arrays
- GET /api/smm/announcement-overlaps endpoint returns JSON object
- Management column has 15 tasks sorted by days_before desc
- SMM column has ~30 tasks sorted by days_before desc
- Marketing column has 2 tasks sorted by days_before desc
- Monthly tasks have column badges (management, smm, marketing)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestTasksDefinitionAPI:
    """Tests for /api/smm/tasks-definition endpoint"""
    
    def test_tasks_definition_returns_all_arrays(self):
        """Test that tasks-definition returns management, smm, marketing, monthly, daily arrays"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify all required arrays exist
        assert "management" in data, "Missing 'management' array"
        assert "smm" in data, "Missing 'smm' array"
        assert "marketing" in data, "Missing 'marketing' array"
        assert "monthly" in data, "Missing 'monthly' array"
        assert "daily" in data, "Missing 'daily' array"
        
        # Verify they are lists
        assert isinstance(data["management"], list), "management should be a list"
        assert isinstance(data["smm"], list), "smm should be a list"
        assert isinstance(data["marketing"], list), "marketing should be a list"
        assert isinstance(data["monthly"], list), "monthly should be a list"
        assert isinstance(data["daily"], list), "daily should be a list"
        
        print(f"✓ tasks-definition returns all 5 arrays: management, smm, marketing, monthly, daily")
    
    def test_management_tasks_count_and_sorting(self):
        """Test management column has 15 tasks sorted by days_before desc"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        management_tasks = data["management"]
        
        # Verify count is 15
        assert len(management_tasks) == 15, f"Expected 15 management tasks, got {len(management_tasks)}"
        
        # Verify sorting by days_before descending
        days_before_values = [t["days_before"] for t in management_tasks]
        assert days_before_values == sorted(days_before_values, reverse=True), \
            f"Management tasks not sorted by days_before desc: {days_before_values}"
        
        # Verify task structure
        for task in management_tasks:
            assert "id" in task, "Task missing 'id'"
            assert "name" in task, "Task missing 'name'"
            assert "days_before" in task, "Task missing 'days_before'"
        
        print(f"✓ Management column has {len(management_tasks)} tasks sorted by days_before desc")
        print(f"  First task: {management_tasks[0]['name']} (days_before: {management_tasks[0]['days_before']})")
        print(f"  Last task: {management_tasks[-1]['name']} (days_before: {management_tasks[-1]['days_before']})")
    
    def test_smm_tasks_count_and_sorting(self):
        """Test SMM column has ~30 tasks sorted by days_before desc"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        smm_tasks = data["smm"]
        
        # Verify count is approximately 30 (allow some variance)
        assert 25 <= len(smm_tasks) <= 35, f"Expected ~30 SMM tasks, got {len(smm_tasks)}"
        
        # Verify sorting by days_before descending
        days_before_values = [t["days_before"] for t in smm_tasks]
        assert days_before_values == sorted(days_before_values, reverse=True), \
            f"SMM tasks not sorted by days_before desc"
        
        # Verify task structure and is_announcement field
        announcement_count = 0
        for task in smm_tasks:
            assert "id" in task, "Task missing 'id'"
            assert "name" in task, "Task missing 'name'"
            assert "days_before" in task, "Task missing 'days_before'"
            if task.get("is_announcement"):
                announcement_count += 1
        
        print(f"✓ SMM column has {len(smm_tasks)} tasks sorted by days_before desc")
        print(f"  Announcement tasks: {announcement_count}")
        print(f"  First task: {smm_tasks[0]['name']} (days_before: {smm_tasks[0]['days_before']})")
        print(f"  Last task: {smm_tasks[-1]['name']} (days_before: {smm_tasks[-1]['days_before']})")
    
    def test_marketing_tasks_count_and_sorting(self):
        """Test marketing column has 2 tasks sorted by days_before desc"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        marketing_tasks = data["marketing"]
        
        # Verify count is 2
        assert len(marketing_tasks) == 2, f"Expected 2 marketing tasks, got {len(marketing_tasks)}"
        
        # Verify sorting by days_before descending
        days_before_values = [t["days_before"] for t in marketing_tasks]
        assert days_before_values == sorted(days_before_values, reverse=True), \
            f"Marketing tasks not sorted by days_before desc: {days_before_values}"
        
        print(f"✓ Marketing column has {len(marketing_tasks)} tasks sorted by days_before desc")
        for task in marketing_tasks:
            print(f"  - {task['name']} (days_before: {task['days_before']})")
    
    def test_monthly_tasks_have_column_badges(self):
        """Test monthly tasks have column field for badges (МНЖ, SMM, МКТ)"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        monthly_tasks = data["monthly"]
        
        # Verify monthly tasks exist
        assert len(monthly_tasks) > 0, "No monthly tasks found"
        
        # Verify each monthly task has a column field
        column_counts = {"management": 0, "smm": 0, "marketing": 0}
        for task in monthly_tasks:
            assert "column" in task, f"Monthly task '{task.get('name', 'unknown')}' missing 'column' field"
            assert task["column"] in ["management", "smm", "marketing"], \
                f"Invalid column value: {task['column']}"
            column_counts[task["column"]] += 1
        
        print(f"✓ Monthly tasks have column badges:")
        print(f"  - МНЖ (management): {column_counts['management']} tasks")
        print(f"  - SMM: {column_counts['smm']} tasks")
        print(f"  - МКТ (marketing): {column_counts['marketing']} tasks")


class TestAnnouncementOverlapsAPI:
    """Tests for /api/smm/announcement-overlaps endpoint"""
    
    def test_announcement_overlaps_returns_json_object(self):
        """Test that announcement-overlaps endpoint returns a JSON object"""
        response = requests.get(f"{BASE_URL}/api/smm/announcement-overlaps")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Verify it returns a dict/object (not a list)
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"
        
        # If there are overlaps, verify structure
        if data:
            for date_key, tasks in data.items():
                assert isinstance(tasks, list), f"Overlap value for {date_key} should be a list"
                for task in tasks:
                    assert "event_id" in task, "Overlap task missing 'event_id'"
                    assert "event_title" in task, "Overlap task missing 'event_title'"
                    assert "task_id" in task, "Overlap task missing 'task_id'"
                    assert "task_name" in task, "Overlap task missing 'task_name'"
            print(f"✓ announcement-overlaps returns {len(data)} dates with overlaps")
        else:
            print(f"✓ announcement-overlaps returns empty object (no overlaps currently)")


class TestEventsAPI:
    """Tests for events API related to event types"""
    
    def test_create_event_with_event_type(self):
        """Test creating event with event_type field"""
        # Create a test event with event_type
        event_data = {
            "title": "TEST_Event_Type_Test",
            "date": "2026-03-15",
            "price": 500,
            "spots": 10,
            "event_type": "new"
        }
        
        response = requests.post(f"{BASE_URL}/api/events", json=event_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        created_event = response.json()
        assert created_event["event_type"] == "new", f"Expected event_type 'new', got {created_event.get('event_type')}"
        
        # Cleanup
        event_id = created_event["id"]
        requests.delete(f"{BASE_URL}/api/events/{event_id}")
        
        print(f"✓ Event created with event_type='new'")
    
    def test_event_types_supported(self):
        """Test that all 3 event types are supported: new, regular, repeat"""
        event_types = ["new", "regular", "repeat"]
        
        for event_type in event_types:
            event_data = {
                "title": f"TEST_Event_{event_type}",
                "date": "2026-03-20",
                "price": 500,
                "spots": 10,
                "event_type": event_type
            }
            
            response = requests.post(f"{BASE_URL}/api/events", json=event_data)
            assert response.status_code == 200, f"Failed to create event with type '{event_type}'"
            
            created_event = response.json()
            assert created_event["event_type"] == event_type
            
            # Cleanup
            requests.delete(f"{BASE_URL}/api/events/{created_event['id']}")
        
        print(f"✓ All 3 event types supported: {event_types}")
    
    def test_get_past_unique_events(self):
        """Test /api/events/past-unique endpoint for repeat event selection"""
        response = requests.get(f"{BASE_URL}/api/events/past-unique")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list of past events"
        
        # Verify structure if events exist
        if data:
            for event in data[:3]:  # Check first 3
                assert "id" in event, "Past event missing 'id'"
                assert "title" in event, "Past event missing 'title'"
                assert "price" in event, "Past event missing 'price'"
        
        print(f"✓ past-unique endpoint returns {len(data)} unique past events")


class TestGoogleCalendarStatus:
    """Tests for Google Calendar connection status"""
    
    def test_google_calendar_status_endpoint(self):
        """Test /api/oauth/calendar/status endpoint"""
        response = requests.get(f"{BASE_URL}/api/oauth/calendar/status")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "connected" in data, "Response missing 'connected' field"
        assert isinstance(data["connected"], bool), "'connected' should be boolean"
        
        if data["connected"]:
            print(f"✓ Google Calendar connected: {data.get('email', 'unknown')}")
        else:
            print(f"✓ Google Calendar not connected (expected for testing)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
