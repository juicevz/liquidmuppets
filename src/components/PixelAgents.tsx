import blueAgent from '../../brand/agents/muppet-blue.png'
import sageAgent from '../../brand/agents/muppet-sage.png'
import stoneAgent from '../../brand/agents/muppet-stone.png'

export function PixelAgents() {
  return (
    <div className="pixel-stage" aria-label="Three original LIQUIDMUPPETS agent characters">
      <div className="pixel-halo" aria-hidden="true" />
      <div className="pixel-agent-frame pixel-agent-frame-blue">
        <img className="pixel-agent pixel-agent-blue" src={blueAgent} alt="Slate blue pixel agent" />
      </div>
      <div className="pixel-agent-frame pixel-agent-frame-stone">
        <img className="pixel-agent pixel-agent-stone" src={stoneAgent} alt="Stone gray pixel agent" />
      </div>
      <div className="pixel-agent-frame pixel-agent-frame-sage">
        <img className="pixel-agent pixel-agent-sage" src={sageAgent} alt="Sage green pixel agent" />
      </div>
      <span className="pixel-stage-shadow" aria-hidden="true" />
    </div>
  )
}
