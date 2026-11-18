test "adds and filters" {
    made = add_tasks(["bg_write", "bg_ship"]);
    assert len(made) == 2 and made[0].title == "bg_write";
    made[0].done = True;
    titles = open_tasks();
    assert "bg_ship" in titles and "bg_write" not in titles;
}
