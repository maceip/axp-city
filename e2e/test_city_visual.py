import json
import time
from pathlib import Path

from conftest import ready, repo_metrics

SHOTS = Path(__file__).parent / "screenshots"
SHOTS.mkdir(exist_ok=True)


def focus(page, repo="acme/forge"):
    page.locator("#repo-search").fill(repo)
    page.locator("#repo-search").press("Tab")
    page.wait_for_function("repo => window.__AXP.diagnostics().selected === repo", arg=repo)
    page.wait_for_timeout(450)


def test_production_routes_use_phaser_and_resolve_all_assets(browser, server):
    page=browser.new_page(viewport=dict(width=1600,height=1000))
    errors=[]; failed=[]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: failed.append((response.status,response.url)) if response.status >=400 else None)
    for path in ["/", "/city", "/city.html"]:
        page.goto(server.url+path)
        page.wait_for_function("Boolean(window.__AXP) && window.__AXP.diagnostics().chunks > 0")
        assert page.locator("#game canvas").count()==1
        assert page.locator("svg#axp-map").count()==0
        state=page.evaluate("window.__AXP.diagnostics()")
        assert state["version"]=="4.2.1" and state["renderer"]==2
    page.screenshot(path=str(SHOTS/"desktop.png"))
    assert not errors and not failed
    page.close()


def test_building_pick_pan_zoom_keyboard_and_inspect(page):
    focus(page)
    page.get_by_role("button",name="Close details").click()
    point=page.evaluate("window.__AXP.screenPoint('acme/forge')")
    page.mouse.click(point["x"],point["y"])
    assert page.locator("#lot-card").get_attribute("data-repo")=="acme/forge"
    assert "HUMAN CREW" in page.locator("#lot-card").inner_text()
    page.screenshot(path=str(SHOTS/"inspect.png"))
    page.get_by_role("button",name="Close details").click()
    before=page.evaluate("window.__AXP.diagnostics()")
    page.mouse.move(800,500);page.mouse.down();page.mouse.move(1010,620,steps=12);page.mouse.up()
    page.wait_for_function("x=>Math.abs(window.__AXP.diagnostics().scrollX-x)>100",arg=before["scrollX"])
    assert page.locator("#lot-card").is_hidden()
    page.mouse.wheel(0,-350)
    page.wait_for_function("z=>window.__AXP.diagnostics().zoom>z",arg=before["zoom"])
    page.keyboard.press("2")
    page.wait_for_function("window.__AXP.diagnostics().selected === 'acme/robots'")
    assert "ROBOT CREW" in page.locator("#lot-card").inner_text()


def test_two_browsers_receive_rules_and_metrics_updates_and_reconnect(page,browser,server):
    other=browser.new_page(viewport=dict(width=1280,height=800));ready(other,server.url)
    second=other.context
    first_pos=server.get("/api/city")["plan"]["placements"][0]
    server.metrics[0].update(stars=42000,openPrs=0,openIssues=9)
    server.save()
    (server.rules/"building.json").write_text(json.dumps(dict(version=1,buildingId=42)))
    (server.rules/"loading-zone.json").write_text(json.dumps(dict(version=1,props=dict(issues=["materials"]))))
    assert server.webhook("acme/forge")==200
    for tab in [page,other]:
        tab.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.buildingId===42")
        lot=tab.evaluate("window.__AXP.snapshot().plan.placements[0].lot")
        assert lot["stars"]==42000 and lot["openIssues"]==9 and lot["showMaterials"] and not lot["showBlueprint"]
    second.set_offline(True)
    other.wait_for_function("document.querySelector('#connection-status').textContent.includes('Reconnecting')")
    server.metrics[0]["stars"]=51000;server.save();server.webhook("acme/forge","missed")
    second.set_offline(False)
    other.wait_for_function("window.__AXP.snapshot().plan.placements[0].lot.stars===51000",timeout=20000)
    server.restart()
    for tab in [page,other]:
        tab.wait_for_function("document.querySelector('#connection-status').textContent==='Offline demo'",timeout=20000)
        tab.reload();tab.wait_for_function("Boolean(window.__AXP)")
        result=tab.evaluate("window.__AXP.snapshot().plan.placements[0]")
        assert result["lot"]["stars"]==51000
        assert (result["x"],result["y"])==(first_pos["x"],first_pos["y"])
    other.close()


def test_new_lot_construction_finishes_without_reload(page,server):
    server.metrics.append(repo_metrics("acme/newcomer",stars=14000,openPrs=3,recentDefaultCommits=1));server.save()
    assert server.webhook("acme/newcomer")==200
    page.wait_for_function("window.__AXP.diagnostics().totalLots===9")
    focus(page,"acme/newcomer")
    assert "UNDER CONSTRUCTION" in page.locator("#lot-card").inner_text()
    page.screenshot(path=str(SHOTS/"construction.png"))
    page.wait_for_function("!document.querySelector('#lot-card').innerText.includes('UNDER CONSTRUCTION')",timeout=50000)
    page.screenshot(path=str(SHOTS/"construction-complete.png"))
    snapshot=server.get("/api/city")
    assert snapshot["plan"]["placements"][-1]["constructing"] is False


def test_mobile_tap_dpad_pinch_and_layout(browser,server):
    context=browser.new_context(viewport=dict(width=390,height=844),device_scale_factor=2,is_mobile=True,has_touch=True)
    page=context.new_page();ready(page,server.url)
    focus(page)
    page.get_by_role("button",name="Close details").tap()
    point=page.evaluate("window.__AXP.screenPoint('acme/forge')")
    page.touchscreen.tap(point["x"],point["y"])
    assert page.locator("#lot-card").get_attribute("data-repo")=="acme/forge"
    page.wait_for_timeout(450)
    page.screenshot(path=str(SHOTS/"mobile-inspect.png"))
    page.get_by_role("button",name="Close details").tap()
    before=page.evaluate("window.__AXP.diagnostics()")
    page.get_by_role("button",name="Move east").tap()
    page.wait_for_function("x=>window.__AXP.diagnostics().scrollX>x+10",arg=before["scrollX"])
    # Multi-touch reaches Phaser through Chromium's actual touch input path.
    cdp=context.new_cdp_session(page)
    points=lambda distance:[dict(x=195-distance,y=400,id=1),dict(x=195+distance,y=400,id=2)]
    cdp.send("Input.dispatchTouchEvent",dict(type="touchStart",touchPoints=points(35)))
    for distance in [40,48,60,75,90]:
        cdp.send("Input.dispatchTouchEvent",dict(type="touchMove",touchPoints=points(distance)));page.wait_for_timeout(30)
    cdp.send("Input.dispatchTouchEvent",dict(type="touchEnd",touchPoints=[]))
    page.wait_for_function("z=>window.__AXP.diagnostics().zoom>z+0.2",arg=before["zoom"])
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    page.screenshot(path=str(SHOTS/"mobile.png"));context.close()


def test_thousand_lots_keep_rendering_bounded_after_camera_travel(browser,large_server):
    page=browser.new_page(viewport=dict(width=1600,height=1000));ready(page,large_server.url)
    initial=page.evaluate("window.__AXP.diagnostics()")
    assert initial["totalLots"]==1000 and initial["visibleLots"]<180
    assert initial["objects"]<2500
    page.keyboard.down("D");page.wait_for_timeout(4200);page.keyboard.up("D")
    page.keyboard.down("S");page.wait_for_timeout(3200);page.keyboard.up("S")
    after=page.evaluate("window.__AXP.diagnostics()")
    assert after["chunks"]<90 and after["objects"]<2500
    timing=page.evaluate("""async()=>{const gaps=[];let last=performance.now();await new Promise(resolve=>{function frame(now){gaps.push(now-last);last=now;if(gaps.length<180)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});gaps.shift();gaps.sort((a,b)=>a-b);return {median:gaps[Math.floor(gaps.length*.5)],p95:gaps[Math.floor(gaps.length*.95)]};}""")
    assert timing["median"]<40 and timing["p95"]<100
    report=dict(initial=initial,after=after,frame_ms=timing,browser=browser.version)
    print(json.dumps(report))
    (SHOTS/"performance.json").write_text(json.dumps(report,indent=2))
    page.screenshot(path=str(SHOTS/"thousand-lots.png"))
    page.close()


def test_wilderness_and_return_keep_existing_lots_in_place(page):
    before=page.evaluate("window.__AXP.snapshot().plan.placements.map(p=>[p.lot.fullName,p.x,p.y])")
    page.keyboard.down("D")
    try:
        page.wait_for_function("document.querySelector('#district-name').textContent==='The Wilds' && window.__AXP.diagnostics().visibleLots===0",timeout=15000)
    finally:
        page.keyboard.up("D")
    page.screenshot(path=str(SHOTS/"wilderness.png"))
    state=page.evaluate("window.__AXP.diagnostics()")
    assert state["visibleLots"]==0 and state["chunks"]<90
    page.get_by_role("button",name="Return to Central Park").click()
    page.wait_for_function("window.__AXP.diagnostics().visibleLots>0")
    assert page.evaluate("window.__AXP.snapshot().plan.placements.map(p=>[p.lot.fullName,p.x,p.y])")==before
