from typing import List


SKILLS: List[dict] = [
    {"id": "general-chat", "name": "General AI Chat", "description": "Natural language conversations powered by your configured OpenAI model.", "available": True},
    {"id": "voice", "name": "Voice Assistant", "description": "Low-latency voice conversations through the OpenAI Realtime API.", "available": True},
    {"id": "coding", "name": "Coding Assistant", "description": "Programming help, debugging, and technical explanations.", "available": True},
    {"id": "research", "name": "Web Research", "description": "Research support. Live web browsing is not connected yet.", "available": False},
    {"id": "files", "name": "File Assistant", "description": "Local file access is not enabled yet.", "available": False},
    {"id": "automation", "name": "MacBook Automation", "description": "Permission-gated launch of approved apps and websites.", "available": True},
    {"id": "productivity", "name": "Productivity Assistant", "description": "Planning, writing, and everyday productivity support.", "available": True},
    {"id": "memory", "name": "Personal Memory", "description": "Review and explicitly save personal notes that inform chat replies.", "available": True},
]
