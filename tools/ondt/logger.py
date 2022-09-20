import os
import logging

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)


def info(*args):
    print(*args)


def debug(*args):
    print(*args)


def warning(*args):
    print(*args)


def error(*args):
    print(*args)
