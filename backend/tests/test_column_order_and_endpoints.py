"""
Test column order changes and new endpoints:
1. GET /api/altegio/status - returns connected boolean
2. GET /api/docs/app-logic - returns markdown file download
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAltegioStatus:
    """Test Altegio status endpoint"""
    
    def test_altegio_status_returns_connected_boolean(self):
        """GET /api/altegio/status should return connected boolean"""
        response = requests.get(f"{BASE_URL}/api/altegio/status")
        
        # Status code assertion
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Data assertions
        data = response.json()
        assert "connected" in data, "Response should contain 'connected' field"
        assert isinstance(data["connected"], bool), "connected should be a boolean"
        print(f"✓ Altegio status: connected={data['connected']}")


class TestDocsAppLogic:
    """Test APP_LOGIC.md download endpoint"""
    
    def test_docs_app_logic_returns_markdown(self):
        """GET /api/docs/app-logic should return markdown file"""
        response = requests.get(f"{BASE_URL}/api/docs/app-logic")
        
        # Status code assertion
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        # Content type should be markdown
        content_type = response.headers.get('content-type', '')
        assert 'text/markdown' in content_type or 'text/plain' in content_type or 'application/octet-stream' in content_type, \
            f"Expected markdown content type, got {content_type}"
        
        # Content should not be empty
        assert len(response.content) > 0, "Response content should not be empty"
        
        # Content should contain markdown-like content
        content = response.text
        assert '#' in content or 'LOGIC' in content.upper(), "Content should contain markdown headers or LOGIC text"
        
        print(f"✓ APP_LOGIC.md download works, content length: {len(response.content)} bytes")


class TestSMMTasksDefinition:
    """Test SMM tasks definition endpoint for column structure"""
    
    def test_smm_tasks_definition_has_all_columns(self):
        """GET /api/smm/tasks-definition should return all task columns"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        
        # Should have management, smm, marketing columns
        assert "management" in data, "Should have management tasks"
        assert "smm" in data, "Should have smm tasks"
        assert "marketing" in data, "Should have marketing tasks"
        assert "monthly" in data, "Should have monthly tasks"
        
        # Each should be a list
        assert isinstance(data["management"], list), "management should be a list"
        assert isinstance(data["smm"], list), "smm should be a list"
        assert isinstance(data["marketing"], list), "marketing should be a list"
        assert isinstance(data["monthly"], list), "monthly should be a list"
        
        print(f"✓ Task definitions: management={len(data['management'])}, smm={len(data['smm'])}, marketing={len(data['marketing'])}, monthly={len(data['monthly'])}")


class TestMonthlyTasks:
    """Test monthly tasks have correct column assignments"""
    
    def test_monthly_tasks_have_column_assignments(self):
        """Monthly tasks should have column field for distribution"""
        response = requests.get(f"{BASE_URL}/api/smm/tasks-definition")
        
        assert response.status_code == 200
        
        data = response.json()
        monthly_tasks = data.get("monthly", [])
        
        # Check that monthly tasks have column assignments
        columns_found = set()
        for task in monthly_tasks:
            if "column" in task:
                columns_found.add(task["column"])
        
        # Should have tasks for management, smm, and marketing columns
        assert "management" in columns_found, "Should have monthly tasks for management"
        assert "smm" in columns_found, "Should have monthly tasks for smm"
        assert "marketing" in columns_found, "Should have monthly tasks for marketing"
        
        print(f"✓ Monthly tasks distributed across columns: {columns_found}")


class TestAPIHealth:
    """Basic API health checks"""
    
    def test_api_root(self):
        """API root should respond"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        print("✓ API root responds")
    
    def test_events_endpoint(self):
        """Events endpoint should respond"""
        response = requests.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        print(f"✓ Events endpoint works, {len(response.json())} events")
    
    def test_settings_endpoint(self):
        """Settings endpoint should respond"""
        response = requests.get(f"{BASE_URL}/api/settings")
        assert response.status_code == 200
        print("✓ Settings endpoint works")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
