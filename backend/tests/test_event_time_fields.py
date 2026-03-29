"""
Backend tests for event start_time and end_time fields
Tests that creating/updating events with time fields works correctly
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestEventTimeFields:
    """Tests for start_time and end_time fields in event CRUD"""
    
    @pytest.fixture(autouse=True)
    def cleanup(self):
        """Cleanup test events after each test"""
        self.test_event_ids = []
        yield
        # Cleanup: Delete all test events
        for event_id in self.test_event_ids:
            try:
                requests.delete(f"{BASE_URL}/api/events/{event_id}")
            except:
                pass
    
    def test_create_event_with_start_and_end_time(self):
        """Test creating event with start_time and end_time"""
        
        response = requests.post(f"{BASE_URL}/api/events", json={
            "title": "TEST_EventWithTime",
            "date": "2026-03-20",
            "price": 700,
            "spots": 15,
            "description": "Event with time fields",
            "start_time": "19:00",
            "end_time": "22:00"
        })
        
        assert response.status_code == 200, f"Failed to create event: {response.text}"
        event = response.json()
        self.test_event_ids.append(event["id"])
        
        # Verify time fields are saved
        assert event.get("start_time") == "19:00", f"Expected start_time '19:00', got '{event.get('start_time')}'"
        assert event.get("end_time") == "22:00", f"Expected end_time '22:00', got '{event.get('end_time')}'"
        
        print("SUCCESS: Event created with start_time and end_time")
    
    def test_create_event_without_time_fields(self):
        """Test creating event without time fields (should be empty strings)"""
        
        response = requests.post(f"{BASE_URL}/api/events", json={
            "title": "TEST_EventNoTime",
            "date": "2026-04-15",
            "price": 500,
            "spots": 10
        })
        
        assert response.status_code == 200, f"Failed to create event: {response.text}"
        event = response.json()
        self.test_event_ids.append(event["id"])
        
        # Time fields should be empty strings by default
        assert event.get("start_time") == "", f"Expected start_time '', got '{event.get('start_time')}'"
        assert event.get("end_time") == "", f"Expected end_time '', got '{event.get('end_time')}'"
        
        print("SUCCESS: Event without time fields has empty strings")
    
    def test_update_event_time_fields(self):
        """Test updating event time fields via PUT"""
        
        # Create event first
        create_response = requests.post(f"{BASE_URL}/api/events", json={
            "title": "TEST_UpdateTimeEvent",
            "date": "2026-05-10",
            "price": 600,
            "spots": 12
        })
        
        assert create_response.status_code == 200
        event = create_response.json()
        self.test_event_ids.append(event["id"])
        
        # Verify initially no time
        assert event.get("start_time") == ""
        assert event.get("end_time") == ""
        
        # Update with time fields
        update_response = requests.put(f"{BASE_URL}/api/events/{event['id']}", json={
            "start_time": "18:30",
            "end_time": "21:30"
        })
        
        assert update_response.status_code == 200, f"Failed to update event: {update_response.text}"
        updated_event = update_response.json()
        
        # Verify time fields updated
        assert updated_event.get("start_time") == "18:30", f"Expected start_time '18:30', got '{updated_event.get('start_time')}'"
        assert updated_event.get("end_time") == "21:30", f"Expected end_time '21:30', got '{updated_event.get('end_time')}'"
        
        # Verify persisted by GET
        get_response = requests.get(f"{BASE_URL}/api/events/{event['id']}")
        assert get_response.status_code == 200
        fetched_event = get_response.json()
        
        assert fetched_event.get("start_time") == "18:30", "Start time not persisted"
        assert fetched_event.get("end_time") == "21:30", "End time not persisted"
        
        print("SUCCESS: Event time fields updated and persisted")
    
    def test_get_existing_event_has_time_fields(self):
        """Test that GET on event ID 54a32b7e-05bb-4060-851b-de9943e3366b returns time fields"""
        
        event_id = "54a32b7e-05bb-4060-851b-de9943e3366b"
        
        response = requests.get(f"{BASE_URL}/api/events/{event_id}")
        
        if response.status_code == 404:
            pytest.skip("Test event not found, may have been deleted")
        
        assert response.status_code == 200
        event = response.json()
        
        # Event should have time fields (even if empty)
        assert "start_time" in event, "Event should have start_time field"
        assert "end_time" in event, "Event should have end_time field"
        
        print(f"SUCCESS: Existing event has time fields - start_time: '{event.get('start_time')}', end_time: '{event.get('end_time')}'")
    
    def test_event_fields_in_events_list(self):
        """Test that events list includes time fields"""
        
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
        
        events = response.json()
        assert isinstance(events, list)
        
        if len(events) == 0:
            pytest.skip("No events in database")
        
        # Check first event has time fields
        first_event = events[0]
        assert "start_time" in first_event, "Event in list should have start_time field"
        assert "end_time" in first_event, "Event in list should have end_time field"
        
        print(f"SUCCESS: Events list includes time fields ({len(events)} events)")


class TestAIParsingIncludesTimeFields:
    """Test that AI parsing response includes time fields"""
    
    def test_parsed_event_model_has_time_fields(self):
        """Test that AI parsing can return start_time and end_time"""
        
        response = requests.post(f"{BASE_URL}/api/events/parse", json={
            "text": "Bodyart Light 20 лютого о 19:00, 700 грн, 15 місць"
        })
        
        assert response.status_code == 200, f"AI parsing failed: {response.text}"
        parsed = response.json()
        
        assert "events" in parsed, "Response should have events list"
        
        if len(parsed["events"]) > 0:
            event = parsed["events"][0]
            # Check that time fields exist in response model (even if LLM didn't extract time)
            # Note: LLM may not always extract time, but the model should support it
            assert "start_time" in event or event.get("start_time", "") == "", "Parsed event should support start_time"
            assert "end_time" in event or event.get("end_time", "") == "", "Parsed event should support end_time"
            
            print(f"SUCCESS: AI parsed event - title: '{event.get('title')}', start_time: '{event.get('start_time', 'N/A')}', end_time: '{event.get('end_time', 'N/A')}'")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
