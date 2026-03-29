"""
Test suite for Content Page and Monthly Tasks features
- Content page /content with header, 4 columns, calendar dots
- Monthly tasks auto-generation and API endpoints
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://task-hub-890.preview.emergentagent.com').rstrip('/')


class TestMonthlyTasksAPI:
    """Tests for monthly tasks generation and status endpoints"""
    
    def test_monthly_tasks_status_returns_list(self):
        """GET /api/monthly-tasks/status returns list of generated months"""
        response = requests.get(f"{BASE_URL}/api/monthly-tasks/status")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Monthly tasks status: {len(data)} months generated")
        
        # Verify structure of each month entry
        for month in data:
            assert "month_key" in month
            assert "count" in month
            assert "generated_at" in month
            print(f"  - {month['month_key']}: {month['count']} tasks")
    
    def test_monthly_tasks_status_has_current_and_next_month(self):
        """Backend auto-generates tasks for current (2026-03) and next month (2026-04)"""
        response = requests.get(f"{BASE_URL}/api/monthly-tasks/status")
        assert response.status_code == 200
        data = response.json()
        
        month_keys = [m["month_key"] for m in data]
        assert "2026-03" in month_keys, "Current month (March 2026) should be generated"
        assert "2026-04" in month_keys, "Next month (April 2026) should be generated"
        print("PASS: Both current and next month tasks are generated")
    
    def test_monthly_tasks_generate_endpoint(self):
        """POST /api/monthly-tasks/generate creates tasks for specified month"""
        # Try to generate for a month that's already generated (should return already_generated)
        response = requests.post(f"{BASE_URL}/api/monthly-tasks/generate?year=2026&month=3")
        assert response.status_code == 200
        data = response.json()
        
        # Should either be "already_generated" or "generated"
        assert data.get("status") in ["already_generated", "generated"]
        assert data.get("month") == "2026-03"
        print(f"Generate endpoint status: {data.get('status')}, count: {data.get('count')}")
    
    def test_standalone_tasks_include_monthly_type(self):
        """GET /api/tasks/standalone returns tasks with type='monthly'"""
        response = requests.get(f"{BASE_URL}/api/tasks/standalone")
        assert response.status_code == 200
        data = response.json()
        
        monthly_tasks = [t for t in data if t.get("type") == "monthly"]
        assert len(monthly_tasks) > 0, "Should have monthly tasks"
        print(f"Total standalone tasks: {len(data)}, Monthly tasks: {len(monthly_tasks)}")
        
        # Verify monthly task structure
        for task in monthly_tasks[:5]:
            assert "id" in task
            assert "title" in task
            assert "date" in task
            assert "assignee" in task
            assert task.get("icon") == "calendar", f"Monthly tasks should have calendar icon, got: {task.get('icon')}"
            print(f"  - {task['title'][:40]} | assignee: {task['assignee']}")
    
    def test_monthly_tasks_have_correct_assignees(self):
        """Monthly tasks appear in correct team columns based on assignee"""
        response = requests.get(f"{BASE_URL}/api/tasks/standalone")
        assert response.status_code == 200
        data = response.json()
        
        monthly_tasks = [t for t in data if t.get("type") == "monthly"]
        
        # Group by assignee
        by_assignee = {"kasya": [], "karolina": [], "vo": []}
        for task in monthly_tasks:
            assignee = task.get("assignee", "karolina")
            if assignee in by_assignee:
                by_assignee[assignee].append(task)
        
        print(f"Monthly tasks by assignee:")
        print(f"  - kasya (SMM): {len(by_assignee['kasya'])} tasks")
        print(f"  - karolina (management): {len(by_assignee['karolina'])} tasks")
        print(f"  - vo (marketing): {len(by_assignee['vo'])} tasks")
        
        # Verify at least some tasks exist for each team
        assert len(by_assignee['kasya']) > 0, "SMM should have monthly tasks"
        assert len(by_assignee['karolina']) > 0, "Management should have monthly tasks"
        assert len(by_assignee['vo']) > 0, "Marketing should have monthly tasks"
    
    def test_monthly_tasks_have_target_month_field(self):
        """Monthly tasks have target_month field"""
        response = requests.get(f"{BASE_URL}/api/tasks/standalone")
        assert response.status_code == 200
        data = response.json()
        
        monthly_tasks = [t for t in data if t.get("type") == "monthly"]
        
        # Check that monthly tasks have target_month
        tasks_with_target = [t for t in monthly_tasks if t.get("target_month")]
        print(f"Monthly tasks with target_month: {len(tasks_with_target)}/{len(monthly_tasks)}")
        
        # Verify target_month format
        for task in tasks_with_target[:5]:
            target = task.get("target_month")
            assert target and len(target) == 7, f"target_month should be YYYY-MM format, got: {target}"
            print(f"  - {task['title'][:30]} -> target: {target}")


class TestSMMTasksDefinition:
    """Tests for SMM tasks definition endpoint"""
    
    def test_smm_tasks_definition_returns_all_columns(self):
        """GET /api/smm/tasks-definition returns management, smm, marketing, monthly, daily"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        data = response.json()
        
        expected_keys = ["management", "smm", "marketing", "monthly", "daily"]
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"
            print(f"  - {key}: {len(data[key])} tasks")
    
    def test_smm_tasks_have_is_announcement_flag(self):
        """SMM tasks have is_announcement flag for calendar dots"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        data = response.json()
        
        smm_tasks = data.get("smm", [])
        announcement_tasks = [t for t in smm_tasks if t.get("is_announcement")]
        
        print(f"SMM tasks with is_announcement=True: {len(announcement_tasks)}")
        for task in announcement_tasks:
            print(f"  - {task['id']}: {task['name']}")
        
        assert len(announcement_tasks) > 0, "Should have announcement tasks"


class TestEventsAPI:
    """Tests for events API"""
    
    def test_get_events(self):
        """GET /api/events returns list of events"""
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Total events: {len(data)}")
        
        # Show some events
        for event in data[:5]:
            print(f"  - {event.get('title', 'N/A')} | {event.get('date', 'N/A')}")
    
    def test_events_have_smm_tasks(self):
        """Events have smm_tasks field with task dates"""
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
        data = response.json()
        
        events_with_smm = [e for e in data if e.get("smm_tasks")]
        print(f"Events with SMM tasks: {len(events_with_smm)}/{len(data)}")
        
        if events_with_smm:
            event = events_with_smm[0]
            print(f"Sample event: {event.get('title')}")
            print(f"  SMM tasks: {len(event.get('smm_tasks', {}))}")


class TestPostsAPI:
    """Tests for posts API (info-posts column)"""
    
    def test_get_posts(self):
        """GET /api/posts returns list of posts"""
        response = requests.get(f"{BASE_URL}/api/posts")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"Total posts: {len(data)}")
    
    def test_create_and_delete_post(self):
        """POST /api/posts creates a new post, DELETE removes it"""
        # Create
        new_post = {
            "id": "test-post-123",
            "title": "TEST_Post for testing",
            "date": "2026-03-25",
            "notes": "Test notes",
            "post_type": "info"
        }
        response = requests.post(f"{BASE_URL}/api/posts", json=new_post)
        assert response.status_code == 200
        created = response.json()
        print(f"Created post: {created.get('title')}")
        
        # Verify it exists
        response = requests.get(f"{BASE_URL}/api/posts")
        posts = response.json()
        found = [p for p in posts if p.get("id") == "test-post-123"]
        assert len(found) == 1, "Post should exist after creation"
        
        # Delete
        response = requests.delete(f"{BASE_URL}/api/posts/test-post-123")
        assert response.status_code == 200
        print("Deleted test post")
        
        # Verify deleted
        response = requests.get(f"{BASE_URL}/api/posts")
        posts = response.json()
        found = [p for p in posts if p.get("id") == "test-post-123"]
        assert len(found) == 0, "Post should be deleted"


class TestHealthAndBasics:
    """Basic health checks"""
    
    def test_api_root(self):
        """GET /api/ returns success"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        print(f"API root: {response.json()}")
    
    def test_settings_endpoint(self):
        """GET /api/settings returns settings"""
        response = requests.get(f"{BASE_URL}/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "reminder_types" in data
        print(f"Settings: {len(data.get('reminder_types', []))} reminder types")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
