"""Test SMM tasks emerald feature"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSMMTasksDefinition:
    """Test SMM tasks definition API returns is_emerald field"""
    
    def test_smm_tasks_definition_endpoint(self):
        """Test that SMM tasks definition returns all tasks"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Expected list response"
        assert len(data) == 22, f"Expected 22 SMM tasks, got {len(data)}"
        print(f"✓ SMM tasks definition returns {len(data)} tasks")
    
    def test_smm_tasks_have_is_emerald_field(self):
        """Test that all SMM tasks have is_emerald field"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        for task in data:
            assert "is_emerald" in task, f"Task {task['id']} missing is_emerald field"
            assert isinstance(task["is_emerald"], bool), f"Task {task['id']} is_emerald should be boolean"
        
        print("✓ All SMM tasks have is_emerald boolean field")
    
    def test_correct_emerald_tasks(self):
        """Test that the correct tasks are marked as emerald"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        emerald_tasks = [t for t in data if t.get("is_emerald")]
        
        # Expected emerald task IDs based on requirements
        expected_emerald_ids = {
            "smm_text_video",           # робота над текстом для відео
            "smm_design_announcement",  # монтаж  
            "smm_approve_announcement", # затвердити анонс
            "smm_storytelling",         # сторітеллінг
            "smm_shoot_content",        # знімати контент
            "smm_post_stories",         # постити сторі відразу з події
            "smm_upload_google",        # оптимізувати і залити контент на гугл фото
            "smm_video_master_subtitles", # монтаж звернення майстра з субтитрами (NEW)
            "smm_video_feedbacks",      # підготувати відео-фідбеки з минулих подій (NEW)
        }
        
        actual_emerald_ids = {t["id"] for t in emerald_tasks}
        
        assert actual_emerald_ids == expected_emerald_ids, f"Emerald tasks mismatch. Expected: {expected_emerald_ids}, Got: {actual_emerald_ids}"
        assert len(emerald_tasks) == 9, f"Expected 9 emerald tasks, got {len(emerald_tasks)}"
        
        print(f"✓ Correct 9 emerald tasks found: {[t['name'] for t in emerald_tasks]}")
    
    def test_new_smm_tasks_exist(self):
        """Test that the two new SMM tasks exist"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        task_ids = {t["id"] for t in data}
        
        # Check new tasks exist
        assert "smm_video_master_subtitles" in task_ids, "Missing smm_video_master_subtitles task"
        assert "smm_video_feedbacks" in task_ids, "Missing smm_video_feedbacks task"
        
        # Check they have correct names
        video_subtitles = next((t for t in data if t["id"] == "smm_video_master_subtitles"), None)
        video_feedbacks = next((t for t in data if t["id"] == "smm_video_feedbacks"), None)
        
        assert video_subtitles is not None
        assert video_feedbacks is not None
        assert video_subtitles["name"] == "монтаж звернення майстра з субтитрами"
        assert video_feedbacks["name"] == "підготувати відео-фідбеки з минулих подій"
        
        # Check they are emerald
        assert video_subtitles["is_emerald"] == True, "smm_video_master_subtitles should be emerald"
        assert video_feedbacks["is_emerald"] == True, "smm_video_feedbacks should be emerald"
        
        print("✓ Two new SMM tasks exist with correct names and emerald status")
    
    def test_text_work_tasks_have_is_text_work_field(self):
        """Test that text work tasks have is_text_work field"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        assert response.status_code == 200
        
        data = response.json()
        
        text_work_ids = {"smm_text_announcement", "smm_text_video", "smm_approve_texts"}
        
        for task in data:
            if task["id"] in text_work_ids:
                assert task.get("is_text_work") == True, f"Task {task['id']} should have is_text_work=True"
            else:
                # Other tasks should have is_text_work = False or not set
                assert task.get("is_text_work", False) == False, f"Task {task['id']} should have is_text_work=False"
        
        print("✓ Text work tasks correctly marked with is_text_work field")


class TestAPIHealth:
    """Test API is healthy"""
    
    def test_api_root(self):
        """Test API root endpoint"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        assert response.json()["message"] == "sensa API"
        print("✓ API is healthy")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
