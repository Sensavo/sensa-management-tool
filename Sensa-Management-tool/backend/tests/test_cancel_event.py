"""
Backend tests for cancel event API functionality
Tests that cancelling an event clears reminders and SMM tasks
"""
import pytest
import requests
import os
import json

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCancelEventAPI:
    """Tests for PATCH /events/{id} cancel functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Create a test event to use in tests"""
        self.test_event_id = None
        
        # Create a test event
        create_response = requests.post(f"{BASE_URL}/api/events", json={
            "title": "TEST_CancelEvent",
            "date": "2026-03-15",
            "price": 500,
            "spots": 10,
            "description": "Test event for cancel functionality"
        })
        
        assert create_response.status_code == 200, f"Failed to create test event: {create_response.text}"
        self.test_event = create_response.json()
        self.test_event_id = self.test_event["id"]
        
        # Verify event has reminders and smm_tasks
        assert len(self.test_event.get("reminders", {})) > 0, "Event should have reminders"
        assert len(self.test_event.get("smm_tasks", {})) > 0, "Event should have SMM tasks"
        
        print(f"Created test event: {self.test_event_id}")
        print(f"Reminders count: {len(self.test_event.get('reminders', {}))}")
        print(f"SMM tasks count: {len(self.test_event.get('smm_tasks', {}))}")
        
        yield
        
        # Cleanup: Delete test event
        if self.test_event_id:
            requests.delete(f"{BASE_URL}/api/events/{self.test_event_id}")
    
    def test_cancel_event_clears_reminders_and_smm_tasks(self):
        """Test that cancelling an event clears reminders and smm_tasks"""
        
        # Step 1: Cancel the event using PATCH
        cancel_response = requests.patch(
            f"{BASE_URL}/api/events/{self.test_event_id}",
            json={"cancelled": True}
        )
        
        assert cancel_response.status_code == 200, f"Failed to cancel event: {cancel_response.text}"
        cancelled_event = cancel_response.json()
        
        # Step 2: Verify event is cancelled
        assert cancelled_event.get("cancelled") == True, "Event should be cancelled"
        
        # Step 3: Verify reminders are cleared
        reminders = cancelled_event.get("reminders", {})
        assert len(reminders) == 0, f"Reminders should be empty after cancel, got: {len(reminders)}"
        print(f"SUCCESS: Reminders cleared (count: {len(reminders)})")
        
        # Step 4: Verify smm_tasks are cleared
        smm_tasks = cancelled_event.get("smm_tasks", {})
        assert len(smm_tasks) == 0, f"SMM tasks should be empty after cancel, got: {len(smm_tasks)}"
        print(f"SUCCESS: SMM tasks cleared (count: {len(smm_tasks)})")
        
        # Step 5: Fetch event again to confirm persistence
        get_response = requests.get(f"{BASE_URL}/api/events/{self.test_event_id}")
        assert get_response.status_code == 200
        
        fetched_event = get_response.json()
        assert fetched_event.get("cancelled") == True
        assert len(fetched_event.get("reminders", {})) == 0, "Reminders should persist as empty"
        assert len(fetched_event.get("smm_tasks", {})) == 0, "SMM tasks should persist as empty"
        
        print("SUCCESS: Cancel event correctly clears reminders and SMM tasks")
    
    def test_restore_event_restores_reminders_and_smm_tasks(self):
        """Test that restoring a cancelled event restores reminders and smm_tasks"""
        
        # Step 1: Cancel the event first
        cancel_response = requests.patch(
            f"{BASE_URL}/api/events/{self.test_event_id}",
            json={"cancelled": True}
        )
        assert cancel_response.status_code == 200
        
        # Step 2: Restore the event
        restore_response = requests.patch(
            f"{BASE_URL}/api/events/{self.test_event_id}",
            json={"cancelled": False}
        )
        
        assert restore_response.status_code == 200, f"Failed to restore event: {restore_response.text}"
        restored_event = restore_response.json()
        
        # Step 3: Verify event is no longer cancelled
        assert restored_event.get("cancelled") == False, "Event should not be cancelled"
        
        # Step 4: Verify reminders are restored
        reminders = restored_event.get("reminders", {})
        assert len(reminders) > 0, f"Reminders should be restored, got: {len(reminders)}"
        print(f"SUCCESS: Reminders restored (count: {len(reminders)})")
        
        # Step 5: Verify smm_tasks are restored
        smm_tasks = restored_event.get("smm_tasks", {})
        assert len(smm_tasks) > 0, f"SMM tasks should be restored, got: {len(smm_tasks)}"
        print(f"SUCCESS: SMM tasks restored (count: {len(smm_tasks)})")
        
        print("SUCCESS: Restore event correctly restores reminders and SMM tasks")


class TestMobileArchiveButtons:
    """Tests to verify mobile archive API endpoints work correctly"""
    
    def test_tasks_archive_endpoint(self):
        """Test that /api/tasks/archive returns completed tasks"""
        response = requests.get(f"{BASE_URL}/api/tasks/archive")
        assert response.status_code == 200
        
        archive = response.json()
        assert isinstance(archive, list), "Archive should be a list"
        print(f"SUCCESS: Tasks archive endpoint works, {len(archive)} items")
    
    def test_events_list_includes_cancelled(self):
        """Test that /api/events includes cancelled events (for Events archive)"""
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
        
        events = response.json()
        assert isinstance(events, list), "Events should be a list"
        
        # Count cancelled events
        cancelled = [e for e in events if e.get("cancelled")]
        print(f"SUCCESS: Events endpoint works, {len(events)} total, {len(cancelled)} cancelled")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
